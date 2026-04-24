"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyLabel = classifyLabel;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const anthropic = new sdk_1.default({ apiKey: process.env.ANTHROPIC_API_KEY });
function buildLabelPrompt(filename, mimeType, contentSnippet, existingTaxonomy) {
    const taxonomySection = [
        existingTaxonomy.types.length ? `Known Types: ${existingTaxonomy.types.join(', ')}` : '',
        existingTaxonomy.froms.length ? `Known Sources: ${existingTaxonomy.froms.join(', ')}` : '',
        existingTaxonomy.contexts.length ? `Known Contexts: ${existingTaxonomy.contexts.join(', ')}` : '',
    ].filter(Boolean).join('\n');
    return `You are a personal filing assistant proposing taxonomy labels for Daniel's archive.

File: ${filename}
MIME type: ${mimeType}
${contentSnippet ? `Content preview (first 1000 chars):\n${contentSnippet.slice(0, 1000)}` : '(no content — classify from filename and metadata only)'}

${taxonomySection ? `Existing taxonomy (prefer existing values when they fit):\n${taxonomySection}` : '(no existing taxonomy — propose new labels)'}

Propose labels on 3 axes:
- Type: what kind of document (Invoice, Contract, Receipt, Photo, Article, Code, etc.)
- From: who or what organisation it's from (use existing taxonomy or propose new)
- Context: life area (Work, Personal, Finance, Travel, Health, etc.)

Derive proposed_drive_path as: {Context}/{Type}s/{From}
Example: Finance/Invoices/Anthropic

Respond with JSON only:
{
  "type": {"value": "...", "confidence": 0.0-1.0},
  "from": {"value": "...", "confidence": 0.0-1.0},
  "context": {"value": "...", "confidence": 0.0-1.0},
  "proposed_drive_path": "..."
}

Rules:
- confidence >= 0.75 means you're confident; below 0.75 means unsure
- value: null if you truly cannot propose (will route to label triage)
- Prefer existing taxonomy values when they fit
- No explanations outside the JSON`;
}
function parseLabelResponse(text) {
    try {
        const clean = text.replace(/```json\n?|\n?```/g, '').trim();
        const parsed = JSON.parse(clean);
        const normalise = (axis) => ({
            value: axis?.value ?? null,
            confidence: typeof axis?.confidence === 'number'
                ? Math.max(0, Math.min(1, axis.confidence))
                : 0,
        });
        const type = normalise(parsed.type);
        const from = normalise(parsed.from);
        const context = normalise(parsed.context);
        const proposed_drive_path = parsed.proposed_drive_path
            ?? [context.value ?? 'Uncategorised', `${type.value ?? 'Files'}s`, from.value ?? 'Unknown'].join('/');
        return { axes: { type, from, context }, proposed_drive_path };
    }
    catch {
        return {
            axes: {
                type: { value: null, confidence: 0 },
                from: { value: null, confidence: 0 },
                context: { value: null, confidence: 0 },
            },
            proposed_drive_path: 'Uncategorised/Files/Unknown',
        };
    }
}
const CONFIDENCE_THRESHOLD = 0.75;
async function classifyLabel(filename, mimeType, contentSnippet, existingTaxonomy) {
    const prompt = buildLabelPrompt(filename, mimeType, contentSnippet, existingTaxonomy);
    const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
    const result = parseLabelResponse(text);
    const allAxesConfident = result.axes.type.confidence >= CONFIDENCE_THRESHOLD &&
        result.axes.from.confidence >= CONFIDENCE_THRESHOLD &&
        result.axes.context.confidence >= CONFIDENCE_THRESHOLD;
    return { ...result, allAxesConfident };
}

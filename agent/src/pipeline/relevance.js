"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyRelevance = classifyRelevance;
exports.classifyGmailRelevance = classifyGmailRelevance;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const anthropic = new sdk_1.default({ apiKey: process.env.ANTHROPIC_API_KEY });
function buildRelevancePrompt(filename, mimeType, content) {
    const contentSection = content.metadataOnly
        ? `File type: ${mimeType}, size: ${content.sizeBytes} bytes (content not available — classify from metadata only)`
        : `File content (first 2000 chars):\n${(content.content ?? '').slice(0, 2000)}`;
    return `You are a personal filing assistant deciding if a file is worth keeping in Daniel's archive.

File: ${filename}
MIME type: ${mimeType}
Size: ${content.sizeBytes} bytes
${contentSection}

Classify this file:
- keep: clearly relevant professional document, contract, receipt, correspondence, reference material
- ignore: clearly junk — installers, temp files, auto-downloads, marketing spam, duplicated noise
- uncertain: ambiguous, cannot confidently decide without more context

Respond with JSON only:
{"decision": "keep"|"ignore"|"uncertain", "confidence": 0.0-1.0, "reason": "one sentence"}

Rules:
- confidence >= 0.75 for keep/ignore to be actionable; else output uncertain
- Err toward uncertain over a wrong ignore
- No explanations outside the JSON`;
}
function buildGmailRelevancePrompt(msg) {
    return `You are a personal filing assistant deciding if an email is worth keeping in Daniel's archive.

Email:
Subject: ${msg.subject ?? '(no subject)'}
From: ${msg.from ?? '(unknown)'}
Preview: ${msg.snippet ?? '(no preview)'}
Size: ${msg.sizeEstimate ?? 0} bytes

Classify this email:
- keep: clearly relevant — contracts, receipts, professional correspondence, travel bookings
- ignore: clearly junk — newsletters, marketing, notifications, automated alerts
- uncertain: ambiguous, cannot confidently decide

Respond with JSON only:
{"decision": "keep"|"ignore"|"uncertain", "confidence": 0.0-1.0, "reason": "one sentence"}`;
}
function parseRelevanceResponse(text) {
    try {
        // Strip any markdown fencing if Claude adds it
        const clean = text.replace(/```json\n?|\n?```/g, '').trim();
        const parsed = JSON.parse(clean);
        const decision = (['keep', 'ignore', 'uncertain'].includes(parsed.decision ?? ''))
            ? parsed.decision
            : 'uncertain';
        const confidence = typeof parsed.confidence === 'number'
            ? Math.max(0, Math.min(1, parsed.confidence))
            : 0.5;
        // Enforce: low confidence -> uncertain regardless of stated decision (CLS-01 threshold 0.75)
        const finalDecision = confidence >= 0.75 ? decision : 'uncertain';
        return { decision: finalDecision, confidence, reason: parsed.reason ?? '' };
    }
    catch {
        return { decision: 'uncertain', confidence: 0, reason: 'parse_error' };
    }
}
async function classifyRelevance(filename, mimeType, content) {
    const prompt = buildRelevancePrompt(filename, mimeType, content);
    const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
    return parseRelevanceResponse(text);
}
async function classifyGmailRelevance(gmailMsg) {
    const prompt = buildGmailRelevancePrompt(gmailMsg);
    const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
    return parseRelevanceResponse(text);
}

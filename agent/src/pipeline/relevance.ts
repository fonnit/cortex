import { readFileSync } from 'fs';
import { resolve } from 'path';
import { claudePrompt } from './claude.js';
import type { ContentResult } from './extractor.js';

function loadIdentity(): string {
  try {
    const raw = readFileSync(resolve(import.meta.dirname, '../../../.cortex-identity.json'), 'utf-8');
    const id = JSON.parse(raw);
    const lines = [`Owner: ${id.owner?.name} (${id.owner?.email})`];
    if (id.known_people?.length) {
      lines.push('Known people: ' + id.known_people.map((p: { name: string; relationship: string }) => `${p.name} (${p.relationship})`).join(', '));
    }
    if (id.filing_rules?.length) {
      lines.push('Filing rules: ' + id.filing_rules.join('; '));
    }
    return lines.join('\n');
  } catch { return ''; }
}

export type RelevanceDecision = 'keep' | 'ignore' | 'uncertain';

export interface RelevanceResult {
  decision: RelevanceDecision;
  confidence: number;
  reason: string;
}

function buildRelevancePrompt(filename: string, mimeType: string, content: ContentResult): string {
  const contentSection = content.metadataOnly
    ? `File type: ${mimeType}, size: ${content.sizeBytes} bytes (content not available — classify from metadata only)`
    : `File content (first 2000 chars):\n${(content.content ?? '').slice(0, 2000)}`;

  const identity = loadIdentity();
  return `You are a personal filing assistant deciding if a file is worth keeping in the owner's archive.

${identity ? `Identity context:\n${identity}\n` : ''}File: ${filename}
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

function buildGmailRelevancePrompt(msg: { subject?: string; from?: string; snippet?: string; sizeEstimate?: number }): string {
  const identity = loadIdentity();
  return `You are a personal filing assistant deciding if an email is worth keeping in the owner's archive.

${identity ? `Identity context:\n${identity}\n` : ''}Email:
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

function parseRelevanceResponse(text: string): RelevanceResult {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { decision: 'uncertain', confidence: 0, reason: 'no_json_found' };
    const parsed = JSON.parse(jsonMatch[0]) as { decision?: string; confidence?: number; reason?: string };

    const decision = (['keep', 'ignore', 'uncertain'].includes(parsed.decision ?? ''))
      ? (parsed.decision as RelevanceDecision)
      : 'uncertain';

    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;

    const finalDecision: RelevanceDecision = confidence >= 0.75 ? decision : 'uncertain';

    return { decision: finalDecision, confidence, reason: parsed.reason ?? '' };
  } catch {
    return { decision: 'uncertain', confidence: 0, reason: 'parse_error' };
  }
}

export async function classifyRelevance(
  filename: string,
  mimeType: string,
  content: ContentResult,
): Promise<RelevanceResult> {
  const prompt = buildRelevancePrompt(filename, mimeType, content);
  const text = await claudePrompt(prompt);
  return parseRelevanceResponse(text);
}

export async function classifyGmailRelevance(gmailMsg: {
  subject?: string;
  from?: string;
  snippet?: string;
  sizeEstimate?: number;
}): Promise<RelevanceResult> {
  const prompt = buildGmailRelevancePrompt(gmailMsg);
  const text = await claudePrompt(prompt);
  return parseRelevanceResponse(text);
}

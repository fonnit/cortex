import { claudePrompt } from './claude.js';
import type { ContentResult } from './extractor.js';
import { fetchIdentityContext } from './identity.js';

export type RelevanceDecision = 'keep' | 'ignore' | 'uncertain';

export interface RelevanceResult {
  decision: RelevanceDecision;
  confidence: number;
  reason: string;
}

function buildRelevancePrompt(filename: string, mimeType: string, content: ContentResult, identityContext = ''): string {
  const contentSection = content.metadataOnly
    ? `File type: ${mimeType}, size: ${content.sizeBytes} bytes (content not available — classify from metadata only)`
    : `File content (first 2000 chars):\n${(content.content ?? '').slice(0, 2000)}`;

  return `You are a personal filing assistant deciding if a file is worth keeping in Daniel's archive.

File: ${filename}
MIME type: ${mimeType}
Size: ${content.sizeBytes} bytes
${contentSection}
${identityContext ? `\nIdentity context:\n${identityContext}\n` : ''}
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

function buildGmailRelevancePrompt(msg: { subject?: string; from?: string; snippet?: string; sizeEstimate?: number }, identityContext = ''): string {
  return `You are a personal filing assistant deciding if an email is worth keeping in Daniel's archive.

Email:
Subject: ${msg.subject ?? '(no subject)'}
From: ${msg.from ?? '(unknown)'}
Preview: ${msg.snippet ?? '(no preview)'}
Size: ${msg.sizeEstimate ?? 0} bytes
${identityContext ? `\nIdentity context:\n${identityContext}\n` : ''}
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
  const identity = await fetchIdentityContext(process.env.CORTEX_USER_ID!);
  const prompt = buildRelevancePrompt(filename, mimeType, content, identity.contextBlock);
  const text = await claudePrompt(prompt);
  return parseRelevanceResponse(text);
}

export async function classifyGmailRelevance(gmailMsg: {
  subject?: string;
  from?: string;
  snippet?: string;
  sizeEstimate?: number;
}): Promise<RelevanceResult> {
  const identity = await fetchIdentityContext(process.env.CORTEX_USER_ID!);
  const prompt = buildGmailRelevancePrompt(gmailMsg, identity.contextBlock);
  const text = await claudePrompt(prompt);
  return parseRelevanceResponse(text);
}

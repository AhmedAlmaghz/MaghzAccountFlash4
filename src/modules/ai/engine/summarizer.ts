import type { LlmMessage } from '../types';
import { llmTextOf } from './llmParts';

/**
 * Progressive conversation summarizer.
 *
 * The context window (30 messages) DROPS older turns entirely — a 60-message
 * session forgets the customer it just spent 20 turns building. This module
 * compresses the dropped prefix into one compact "سجل سابق للجلسة" block so
 * business memory survives long sessions without growing the request.
 *
 * Two layers:
 *   1. extractiveDigest — deterministic, free, instant: keeps user asks,
 *      executed writes (tool name + key args + outcome), and assistant
 *      conclusions. Runs on every send, no LLM call.
 *   2. LLM re-summarization is intentionally NOT done here: a provider call
 *      per send adds cost + latency + a failure mode for marginal gain over
 *      the extractive digest. The digest is capped and stable.
 */

const MAX_DIGEST_CHARS = 1500;
const MAX_DIGEST_LINES = 40;

/** Compact one message into ≤1 digest line (or skip it). */
function digestLine(m: LlmMessage): string | null {
  if (m.role === 'user') {
    const text = llmTextOf(m.content).replace(/\s+/g, ' ').trim();
    if (!text) return null;
    // Strip attachment fences — the summary needs the ask, not the payload.
    // The opening fence line ends with '>>>' itself, so the lazy match must
    // span from the opening marker to the CLOSING marker, never stopping at
    // the header's own arrow cluster.
    const stripped = text
      .replace(/<<<BEGIN_ATTACHMENT[\s\S]*?<<<END_ATTACHMENT>>>/g, '[مرفق]')
      .trim();
    const ask = stripped.slice(0, 120);
    return ask ? `👤 طلب: ${ask}` : null;
  }
  if (m.role === 'assistant') {
    if (m.tool_calls && m.tool_calls.length > 0) return null; // outcome arrives via the tool result
    const text = llmTextOf(m.content).replace(/\s+/g, ' ').trim();
    if (!text) return null;
    // Keep only lines that look like conclusions/numbers — not prose.
    const meaningful = text.length <= 200 ? text : text.slice(0, 200);
    return `🤖 رد: ${meaningful}`;
  }
  if (m.role === 'tool') {
    // Executed tool outcome — the strongest memory (documents/IDs created).
    return `🔧 نتيجة أداة: ${llmTextOf(m.content).replace(/\s+/g, ' ').slice(0, 140)}`;
  }
  return null;
}

/**
 * Deterministic digest of the messages the window is about to drop.
 * Returns null when there is nothing worth remembering (short/generic).
 */
export function extractiveDigest(dropped: LlmMessage[]): string | null {
  const lines: string[] = [];
  for (const m of dropped) {
    if (lines.length >= MAX_DIGEST_LINES) break;
    const line = digestLine(m);
    if (line) lines.push(line);
  }
  if (lines.length === 0) return null;
  let digest = lines.join('\n');
  if (digest.length > MAX_DIGEST_CHARS) {
    digest = `${digest.slice(0, MAX_DIGEST_CHARS)}\n… (اقتُطع)`;
  }
  return digest;
}

/** Build the injected prefix message carrying the earlier-session memory. */
export function digestMessage(digest: string): LlmMessage {
  return {
    role: 'user',
    content: `[[سجل مُختصر لبداية الجلسة — سياق فقط، التعليمات الحالية من المستخدم تسبقه]]\n${digest}`,
  };
}

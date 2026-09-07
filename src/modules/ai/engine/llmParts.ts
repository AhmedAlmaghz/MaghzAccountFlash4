import type { LlmContentPart, LlmMessage } from '../types';
import type { PreparedAttachment } from '../attachments/attachmentTypes';
import { ATTACHMENT_LIMITS, attachmentKindLabel } from '../attachments/attachmentTypes';

/**
 * Multimodal message helpers (Package B).
 *
 * - llmTextOf: every engine reader that assumed string content funnels
 *   through here (strip/claims/flatten paths stay correct for part arrays).
 * - buildUserParts: user text + canonical extraction blocks + live binaries.
 *   The extraction block is authoritative (chip = source of truth) — the
 *   editable draft in the textarea is advisory.
 * - pruneMediaForWire: images/audio ride ONLY on the latest user turn.
 *   Older turns collapse to their text parts (extraction already inline),
 *   so long sessions stop re-sending base64 every request.
 */

/** Plain-text view of any message content shape. */
export function llmTextOf(content: LlmMessage['content']): string {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

/** Canonical extraction block appended by the engine (not the textarea). */
export function attachmentContextBlock(
  name: string,
  kind: string,
  extractedText: string | null | undefined,
): string {
  const label = attachmentKindLabel(kind as never) ?? kind;
  const body = (extractedText || '').trim();
  if (body) return `[مرفق: ${name} (${label})]\n${body}`;
  if (kind === 'image') return `[مرفق: ${name} (${label}) — اقرأ محتواها البصري مباشرة]`;
  if (kind === 'audio') return `[مرفق: ${name} (${label}) — فرّغ المقطع الصوتي ثم نفّذ المطلوب فيه]`;
  return `[مرفق: ${name} (${label})]`;
}

function audioFormatOf(mime: string, name: string): string {
  const m = (mime || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (m.includes('wav') || n.endsWith('.wav')) return 'wav';
  return 'mp3';
}

function base64OfDataUrl(dataUrl: string): string {
  const i = dataUrl.indexOf(',');
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

/**
 * Build the user message content: plain string when there is nothing but
 * text, otherwise a parts array (text + image/audio binaries).
 */
export function buildUserParts(text: string, attachments: PreparedAttachment[]): string | LlmContentPart[] {
  const live = attachments.filter((a) => a.dataUrl);
  const blocks = attachments.map((a) =>
    attachmentContextBlock(a.meta.name, a.meta.kind, a.meta.extractedText),
  );
  const fullText = [text, ...blocks].filter(Boolean).join('\n\n');
  if (live.length === 0) return fullText;

  const parts: LlmContentPart[] = [{ type: 'text', text: fullText }];
  for (const a of live) {
    const url = a.dataUrl as string;
    if (a.meta.kind === 'image') {
      parts.push({ type: 'image_url', image_url: { url } });
    } else if (a.meta.kind === 'audio') {
      parts.push({
        type: 'input_audio',
        input_audio: { data: base64OfDataUrl(url), format: audioFormatOf(a.meta.mime, a.meta.name) },
      });
    }
  }
  return parts.length === 1 ? fullText : parts;
}

/**
 * Wire-prune: collapse media parts of every user message EXCEPT the latest
 * user turn to text-only. Pure — history untouched, only the sent copy.
 */
export function pruneMediaForWire(messages: LlmMessage[]): LlmMessage[] {
  let lastUser = -1;
  messages.forEach((m, i) => {
    if (m.role === 'user') lastUser = i;
  });
  return messages.map((m, i) => {
    if (i === lastUser || m.role !== 'user' || !Array.isArray(m.content)) return m;
    const text = llmTextOf(m.content);
    const note = `\n[مرفقات سابقة — محتواها النصي أعلاه؛ الصور/الصوت الأصلي لم يُعَد إرساله]`;
    return { ...m, content: `${text}${text.includes('مرفق:') ? note : ''}` };
  });
}

/** Guard: total extracted text budget per send (context-window protection). */
export function trimAttachmentsToBudget<T extends { meta: { extractedText?: string | null } }>(
  attachments: T[],
  cap: number = ATTACHMENT_LIMITS.EXTRACTED_TEXT_CAP,
): T[] {
  let used = 0;
  return attachments.map((a) => {
    const text = a.meta.extractedText || '';
    if (used >= cap) return { ...a, meta: { ...a.meta, extractedText: null } };
    const room = cap - used;
    used += text.length;
    if (text.length <= room) return a;
    return { ...a, meta: { ...a.meta, extractedText: `${text.slice(0, room)}\n… (اقتُطع لبقية الحد)` } };
  });
}

/**
 * Chat attachment model (Package B: multimodal intake).
 *
 * Two halves with different lifetimes:
 * - ChatAttachmentMeta  — persisted in ai_chat_messages.attachments (metadata
 *   + locally extracted text). Survives reloads; keeps the conversation
 *   meaningful after the binary is gone.
 * - PreparedAttachment  — meta + live binary (dataUrl) for the send path.
 *   In-memory only (attachmentBlobs registry); expires with the renderer.
 *
 * Golden rules applied:
 * - No base64 in Postgres chat saves (rewrite-everything saves would bloat).
 * - Canvas redraw strips EXIF/GPS before any image leaves the device.
 * - Heavy parsers (xlsx, pdfjs) are dynamic-imported — never in the main
 *   bundle (same rule as jspdf/xlsx export chunks).
 */

export type AttachmentKind = 'image' | 'pdf' | 'spreadsheet' | 'audio' | 'other';

export interface ChatAttachmentMeta {
  id: string;
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  /** Locally extracted text (pdf/xlsx drafts). Authoritative input for the model. */
  extractedText?: string | null;
  /** Printable Arabic draft block shown in the input box. */
  draftSummary?: string | null;
  pageCount?: number | null;
  rowCount?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface PreparedAttachment {
  meta: ChatAttachmentMeta;
  /** Downscaled image / original audio as data URL. Null when expired or text-only. */
  dataUrl: string | null;
}

/** Intake caps — documented, enforced in extract.ts, surfaced in Arabic errors. */
export const ATTACHMENT_LIMITS = {
  /** Images are downscaled to this longest edge (jpeg) before sending. */
  IMAGE_MAX_DIM: 1600,
  IMAGE_JPEG_QUALITY: 0.85,
  MAX_IMAGE_BYTES: 5 * 1024 * 1024,
  MAX_PDF_BYTES: 10 * 1024 * 1024,
  /** Only the first pages are text-extracted; the rest travel as vision. */
  PDF_MAX_PAGES: 5,
  MAX_SHEET_BYTES: 10 * 1024 * 1024,
  /** Draft preview rows; the full grid stays out of the context window. */
  SHEET_DRAFT_ROWS: 15,
  SHEET_DRAFT_COLS: 20,
  MAX_AUDIO_BYTES: 10 * 1024 * 1024,
  /** Per-message extracted-text budget — protects the context window. */
  EXTRACTED_TEXT_CAP: 20_000,
} as const;

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
const SHEET_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
]);
const SHEET_EXTS = ['xlsx', 'xls', 'csv'];
const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'mp4', 'webm', 'ogg'];

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Classify an intake file. Pure — fully unit-testable. */
export function classifyAttachment(name: string, mime: string): AttachmentKind {
  const m = (mime || '').toLowerCase().split(';')[0].trim();
  const ext = extOf(name || '');
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (IMAGE_MIMES.has(m) || IMAGE_EXTS.includes(ext)) return 'image';
  if (SHEET_MIMES.has(m) || SHEET_EXTS.includes(ext)) return 'spreadsheet';
  if (m.startsWith('audio/') || AUDIO_EXTS.includes(ext)) return 'audio';
  return 'other';
}

/** Human Arabic label for a kind — used in chips, drafts and errors. */
export function attachmentKindLabel(kind: AttachmentKind): string {
  switch (kind) {
    case 'image': return 'صورة';
    case 'pdf': return 'ملف PDF';
    case 'spreadsheet': return 'جدول بيانات';
    case 'audio': return 'ملف صوتي';
    case 'other': return 'ملف';
  }
}

/** Compact size label with Arabic units and Latin digits. */
export function formatAttachmentSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} بايت`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} ك.ب`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} م.ب`;
}

/**
 * Target canvas size preserving aspect ratio, longest edge = maxDim.
 * Pure — the canvas call itself stays in extract.ts (jsdom has no canvas).
 */
export function computeTargetSize(width: number, height: number, maxDim: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= maxDim) return { width, height };
  const scale = maxDim / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

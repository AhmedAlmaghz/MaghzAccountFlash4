import {
  ATTACHMENT_LIMITS,
  attachmentKindLabel,
  classifyAttachment,
  computeTargetSize,
  formatAttachmentSize,
  type AttachmentKind,
  type ChatAttachmentMeta,
  type PreparedAttachment,
} from './attachmentTypes';
import { putAttachmentBlob } from './attachmentBlobs';

/**
 * Local file intake pipeline (Package B).
 *
 * Layered extraction (best practice):
 *  1. Native text first — xlsx cells via SheetJS, PDF text-layer via pdfjs.
 *     Fast, free, deterministic — no LLM tokens spent on machine-readable data.
 *  2. Vision for images — downscaled client-side, read by the model directly.
 *  3. Audio attached as-is — transcribed + interpreted by the model in one step.
 *
 * Heavy parsers stay dynamic-imported (same rule as jspdf/xlsx export chunks).
 * Every failure is an Arabic, actionable error — never a silent drop.
 */

export interface ProcessedFile {
  attachment: PreparedAttachment;
  /** True when the same sha256 is already pending in this input. */
  duplicateOfPending: boolean;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `att-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

/** SHA-256 hex fingerprint — re-uploads of the same file dedupe on this. */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function limitFor(kind: AttachmentKind): number {
  switch (kind) {
    case 'image': return ATTACHMENT_LIMITS.MAX_IMAGE_BYTES;
    case 'pdf': return ATTACHMENT_LIMITS.MAX_PDF_BYTES;
    case 'spreadsheet': return ATTACHMENT_LIMITS.MAX_SHEET_BYTES;
    case 'audio': return ATTACHMENT_LIMITS.MAX_AUDIO_BYTES;
    case 'other': return 0;
  }
}

function baseMeta(file: File, kind: AttachmentKind, sha256: string): ChatAttachmentMeta {
  return {
    id: newId(),
    kind,
    name: file.name || 'ملف بلا اسم',
    mime: file.type || 'application/octet-stream',
    size: file.size,
    sha256,
    extractedText: null,
    draftSummary: null,
    pageCount: null,
    rowCount: null,
    width: null,
    height: null,
  };
}

/**
 * Downscale an image (longest edge → IMAGE_MAX_DIM, jpeg) and return a data
 * URL. The canvas redraw drops EXIF/GPS — nothing location-identifying
 * leaves the device. Rejects files that are not decodable images.
 */
export async function downscaleImage(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const target = computeTargetSize(bitmap.width, bitmap.height, ATTACHMENT_LIMITS.IMAGE_MAX_DIM);
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('تعذّر تهيئة الرسم');
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    const dataUrl = canvas.toDataURL('image/jpeg', ATTACHMENT_LIMITS.IMAGE_JPEG_QUALITY);
    return { dataUrl, width: target.width, height: target.height };
  } finally {
    bitmap.close();
  }
}

interface SheetDraft {
  sheetName: string;
  headers: string[];
  rows: string[][];
  totalRows: number;
  totalCols: number;
}

/** Parse the first sheet — headers + preview rows. Lazy SheetJS import. */
export async function extractSpreadsheet(file: File): Promise<SheetDraft> {
  const { read, utils } = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = read(buffer, { type: 'array', sheetRows: 5000 });
  const firstName = workbook.SheetNames[0];
  if (!firstName) throw new Error('ملف الجداول فارغ — لا توجد أوراق');
  const sheet = workbook.Sheets[firstName];
  const grid = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true }) as unknown[][];
  const nonEmpty = grid.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (nonEmpty.length === 0) throw new Error('الورقة الأولى فارغة — لا توجد بيانات');
  const cols = Math.min(
    ATTACHMENT_LIMITS.SHEET_DRAFT_COLS,
    Math.max(...nonEmpty.map((r) => r.length)),
  );
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '';
    return String(v).trim().slice(0, 200);
  };
  return {
    sheetName: firstName,
    headers: nonEmpty[0].slice(0, cols).map(cell),
    rows: nonEmpty.slice(1, 1 + ATTACHMENT_LIMITS.SHEET_DRAFT_ROWS).map((r) => {
      const out = r.slice(0, cols).map(cell);
      while (out.length < cols) out.push('');
      return out;
    }),
    totalRows: Math.max(0, nonEmpty.length - 1),
    totalCols: cols,
  };
}

/** Extract text from the first PDF_MAX_PAGES pages. Lazy pdfjs import. */
export async function extractPdfText(file: File): Promise<{ text: string; pages: number }> {
  const pdfjs = await import('pdfjs-dist');
  const { getDocument, GlobalWorkerOptions } = pdfjs as unknown as {
    getDocument: (opts: { data: ArrayBuffer }) => { promise: Promise<PdfDocument> };
    GlobalWorkerOptions: { workerSrc: string };
  };
  interface PdfPage {
    getTextContent: () => Promise<{ items: Array<{ str?: string }> }>;
  }
  interface PdfDocument {
    numPages: number;
    getPage: (n: number) => Promise<PdfPage>;
    destroy: () => Promise<void>;
  }
  if (!GlobalWorkerOptions.workerSrc) {
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    GlobalWorkerOptions.workerSrc = (worker as { default: string }).default;
  }
  const buffer = await file.arrayBuffer();
  const doc = await getDocument({ data: buffer }).promise;
  try {
    const pages = Math.min(doc.numPages, ATTACHMENT_LIMITS.PDF_MAX_PAGES);
    const chunks: string[] = [];
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const line = content.items.map((it) => it.str ?? '').join(' ').replace(/\s+/g, ' ').trim();
      if (line) chunks.push(line);
    }
    return { text: chunks.join('\n'), pages: doc.numPages };
  } finally {
    await doc.destroy().catch(() => {});
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('تعذّرت قراءة الملف'));
    };
    reader.onerror = () => reject(new Error('تعذّرت قراءة الملف'));
    reader.readAsDataURL(file);
  });
}

/**
 * Full intake for one file: classify → cap → fingerprint → kind pipeline.
 * Returns the prepared attachment (meta + live binary when applicable).
 * Throws Arabic errors for unsupported/oversized/unreadable files.
 */
export async function processAttachmentFile(
  file: File,
  pendingHashes: ReadonlySet<string> = new Set(),
): Promise<ProcessedFile> {
  const kind = classifyAttachment(file.name, file.type);
  if (kind === 'other') {
    throw new Error(`نوع الملف غير مدعوم (${file.name || '؟'}) — المدعوم: صور، PDF، إكسل/CSV، ملفات صوتية`);
  }
  const cap = limitFor(kind);
  if (file.size > cap) {
    throw new Error(
      `${attachmentKindLabel(kind)} أكبر من الحد (${formatAttachmentSize(cap)}) — حجم الملف ${formatAttachmentSize(file.size)}`,
    );
  }
  if (file.size === 0) throw new Error(`الملف فارغ (${file.name || '؟'})`);

  const buffer = await file.arrayBuffer();
  const sha256 = await sha256Hex(buffer);
  const duplicateOfPending = pendingHashes.has(sha256);
  const meta = baseMeta(file, kind, sha256);
  let dataUrl: string | null = null;

  if (kind === 'image') {
    const down = await downscaleImage(file);
    dataUrl = down.dataUrl;
    meta.width = down.width;
    meta.height = down.height;
  } else if (kind === 'pdf') {
    const pdf = await extractPdfText(file);
    meta.pageCount = pdf.pages;
    meta.extractedText = pdf.text.slice(0, ATTACHMENT_LIMITS.EXTRACTED_TEXT_CAP) || null;
  } else if (kind === 'spreadsheet') {
    const sheet = await extractSpreadsheet(file);
    meta.rowCount = sheet.totalRows;
    meta.extractedText = renderSheetDraft(sheet).slice(0, ATTACHMENT_LIMITS.EXTRACTED_TEXT_CAP);
  } else if (kind === 'audio') {
    dataUrl = await readAsDataUrl(file);
  }

  if (dataUrl) putAttachmentBlob(meta.id, dataUrl, dataUrl.length);
  return { attachment: { meta, dataUrl }, duplicateOfPending };
}

/** Tabular preview block shared by the draft printer and the LLM input. */
export function renderSheetDraft(sheet: SheetDraft): string {
  const lines = [
    `الورقة: ${sheet.sheetName} — ${sheet.totalRows} صف بيانات × ${sheet.totalCols} أعمدة`,
    `| ${sheet.headers.join(' | ')} |`,
    ...sheet.rows.map((r) => `| ${r.join(' | ')} |`),
  ];
  if (sheet.totalRows > sheet.rows.length) {
    lines.push(`… (${sheet.totalRows - sheet.rows.length} صف إضافي لم يُعرض)`);
  }
  return lines.join('\n');
}

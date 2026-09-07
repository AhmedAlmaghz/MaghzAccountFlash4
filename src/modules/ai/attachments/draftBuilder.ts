import {
  attachmentKindLabel,
  formatAttachmentSize,
  type ChatAttachmentMeta,
} from './attachmentTypes';
import { renderSheetDraft } from './extract';

/**
 * Printable Arabic draft block for one attachment.
 *
 * The block is appended to the input box (editable — the user reviews,
 * trims or adds guidance before sending) AND re-attached canonically by
 * the engine at send time (chip = source of truth, textarea edits are
 * advisory). Keep it compact: header + substance, never the whole file.
 */

export function buildAttachmentDraftBlock(meta: ChatAttachmentMeta): string {
  const header = `📎 المرفق: ${meta.name} (${attachmentKindLabel(meta.kind)} — ${formatAttachmentSize(meta.size)})`;
  switch (meta.kind) {
    case 'image': {
      const dims = meta.width && meta.height ? ` — ${meta.width}×${meta.height}` : '';
      return `${header}${dims}\nسأقرأ محتوى الصورة مباشرة عند الإرسال.`;
    }
    case 'pdf': {
      const pages = meta.pageCount ? ` — ${meta.pageCount} صفحات` : '';
      const body = meta.extractedText?.trim()
        ? `\nالنص المستخرج:\n${meta.extractedText.trim()}`
        : '\n(تعذّر استخراج نص — قد تكون الصفحات ممسوحة ضوئياً، سأقرأها كصور)';
      return `${header}${pages}${body}`;
    }
    case 'spreadsheet': {
      const body = meta.extractedText?.trim()
        ? `\nالمحتوى المستخرج:\n${meta.extractedText.trim()}`
        : '\n(تعذّر استخراج الخلايا)';
      const rows = meta.rowCount ? ` — ${meta.rowCount} صفوف` : '';
      return `${header}${rows}${body}`;
    }
    case 'audio': {
      return `${header}\nسأفرّغ المقطع الصوتي وأفسّر المطلوب منه عند الإرسال.`;
    }
    case 'other':
      return header;
  }
}

/** Re-export for callers that only need the sheet renderer via the barrel. */
export { renderSheetDraft };

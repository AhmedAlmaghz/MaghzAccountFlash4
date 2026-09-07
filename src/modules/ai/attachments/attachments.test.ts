import { describe, it, expect, beforeEach } from 'vitest';
import {
  ATTACHMENT_LIMITS,
  attachmentKindLabel,
  classifyAttachment,
  computeTargetSize,
  formatAttachmentSize,
} from './attachmentTypes';
import {
  attachmentBlobStats,
  clearAttachmentBlobs,
  dropAttachmentBlob,
  getAttachmentBlob,
  hasAttachmentBlob,
  putAttachmentBlob,
} from './attachmentBlobs';
import { buildAttachmentDraftBlock } from './draftBuilder';
import { renderSheetDraft } from './extract';
import type { ChatAttachmentMeta } from './attachmentTypes';

describe('classifyAttachment', () => {
  it('detects pdf by mime and by extension', () => {
    expect(classifyAttachment('كشف.pdf', 'application/pdf')).toBe('pdf');
    expect(classifyAttachment('كشف.PDF', '')).toBe('pdf');
  });

  it('detects images', () => {
    expect(classifyAttachment('فاتورة.jpg', 'image/jpeg')).toBe('image');
    expect(classifyAttachment('receipt.PNG', '')).toBe('image');
    expect(classifyAttachment('x.webp', 'image/webp')).toBe('image');
  });

  it('detects spreadsheets incl. csv', () => {
    expect(classifyAttachment('أسعار.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('spreadsheet');
    expect(classifyAttachment('data.csv', 'text/csv')).toBe('spreadsheet');
    expect(classifyAttachment('old.xls', '')).toBe('spreadsheet');
  });

  it('detects audio', () => {
    expect(classifyAttachment('ملاحظة.mp3', 'audio/mpeg')).toBe('audio');
    expect(classifyAttachment('v.wav', '')).toBe('audio');
  });

  it('rejects executables and unknowns as other', () => {
    expect(classifyAttachment('setup.exe', 'application/x-msdownload')).toBe('other');
    expect(classifyAttachment('notes.txt', 'text/plain')).toBe('other');
    expect(classifyAttachment('noext', '')).toBe('other');
  });
});

describe('formatAttachmentSize', () => {
  it('formats bytes/kb/mb in Arabic units', () => {
    expect(formatAttachmentSize(500)).toBe('500 بايت');
    expect(formatAttachmentSize(2048)).toBe('2.0 ك.ب');
    expect(formatAttachmentSize(5 * 1024 * 1024)).toBe('5.0 م.ب');
    expect(formatAttachmentSize(-1)).toBe('—');
  });
});

describe('computeTargetSize', () => {
  it('keeps small images untouched', () => {
    expect(computeTargetSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('scales the longest edge to the cap preserving ratio', () => {
    expect(computeTargetSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(computeTargetSize(1000, 3000, 1600)).toEqual({ width: 533, height: 1600 });
  });

  it('guards degenerate input', () => {
    expect(computeTargetSize(0, 0, 1600)).toEqual({ width: 0, height: 0 });
  });
});

describe('attachmentKindLabel', () => {
  it('labels every kind in Arabic', () => {
    expect(attachmentKindLabel('image')).toBe('صورة');
    expect(attachmentKindLabel('pdf')).toBe('ملف PDF');
    expect(attachmentKindLabel('spreadsheet')).toBe('جدول بيانات');
    expect(attachmentKindLabel('audio')).toBe('ملف صوتي');
  });
});

describe('attachmentBlobs registry', () => {
  beforeEach(() => clearAttachmentBlobs());

  it('stores and retrieves by id', () => {
    putAttachmentBlob('a1', 'data:image/jpeg;base64,xx', 100);
    expect(hasAttachmentBlob('a1')).toBe(true);
    expect(getAttachmentBlob('a1')).toBe('data:image/jpeg;base64,xx');
    expect(attachmentBlobStats().count).toBe(1);
  });

  it('misses unknown ids (expired semantics)', () => {
    expect(getAttachmentBlob('ghost')).toBeNull();
    expect(hasAttachmentBlob('ghost')).toBe(false);
  });

  it('drops and clears', () => {
    putAttachmentBlob('a1', 'x', 10);
    dropAttachmentBlob('a1');
    expect(hasAttachmentBlob('a1')).toBe(false);
    putAttachmentBlob('a1', 'x', 10);
    putAttachmentBlob('a2', 'y', 10);
    clearAttachmentBlobs();
    expect(attachmentBlobStats()).toEqual({ count: 0, bytes: 0 });
  });
});

function meta(over: Partial<ChatAttachmentMeta>): ChatAttachmentMeta {
  return {
    id: 'm1', kind: 'pdf', name: 'كشف.pdf', mime: 'application/pdf',
    size: 1024, sha256: 'abc', extractedText: null, draftSummary: null,
    pageCount: null, rowCount: null, width: null, height: null, ...over,
  };
}

describe('buildAttachmentDraftBlock', () => {
  it('prints image dims and vision note', () => {
    const block = buildAttachmentDraftBlock(meta({ kind: 'image', name: 'r.jpg', width: 1600, height: 1200 }));
    expect(block).toContain('r.jpg');
    expect(block).toContain('صورة');
    expect(block).toContain('1600×1200');
  });

  it('prints pdf text when extracted', () => {
    const block = buildAttachmentDraftBlock(meta({ extractedText: 'رصيد 5000', pageCount: 3 }));
    expect(block).toContain('3 صفحات');
    expect(block).toContain('رصيد 5000');
  });

  it('falls back honestly when pdf has no text layer', () => {
    const block = buildAttachmentDraftBlock(meta({ extractedText: null }));
    expect(block).toContain('ممسوحة');
  });

  it('prints audio note', () => {
    const block = buildAttachmentDraftBlock(meta({ kind: 'audio', name: 'v.mp3' }));
    expect(block).toContain('الصوتي');
  });
});

describe('renderSheetDraft', () => {
  it('renders headers, rows and overflow note', () => {
    const text = renderSheetDraft({
      sheetName: 'الأسعار',
      headers: ['الصنف', 'السعر'],
      rows: [['أرز', '100'], ['سكر', '200']],
      totalRows: 30,
      totalCols: 2,
    });
    expect(text).toContain('الأسعار');
    expect(text).toContain('| الصنف | السعر |');
    expect(text).toContain('| أرز | 100 |');
    expect(text).toContain('28 صف إضافي');
  });
});

describe('ATTACHMENT_LIMITS', () => {
  it('caps are the documented values', () => {
    expect(ATTACHMENT_LIMITS.IMAGE_MAX_DIM).toBe(1600);
    expect(ATTACHMENT_LIMITS.MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
    expect(ATTACHMENT_LIMITS.PDF_MAX_PAGES).toBe(5);
    expect(ATTACHMENT_LIMITS.SHEET_DRAFT_ROWS).toBe(15);
  });
});

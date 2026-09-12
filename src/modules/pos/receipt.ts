import type { PosShift, PosShiftSummary } from './types';

/** Company fields the receipt templates render (subset of the store Company). */
export interface PosPrintCompany {
  name?: string;
  taxNumber?: string;
  address?: string;
  phone?: string;
}

/**
 * POS receipt + Z-report printing — 80mm RTL templates via window.print
 * (the practical Electron path; thermalPrinter.printViaBrowser is the model).
 * Escape EVERYTHING user-provided to keep the print window inert.
 */

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PRINT_CSS = `
  @page { size: 80mm auto; margin: 2mm; }
  body { font-family: 'Cairo', 'Segoe UI', sans-serif; width: 74mm; margin: 0 auto; color: #000; font-size: 11px; direction: rtl; }
  .center { text-align: center; }
  .row { display: flex; justify-content: space-between; gap: 6px; }
  .bold { font-weight: 700; }
  .big { font-size: 14px; }
  .line { border-bottom: 1px dashed #000; margin: 4px 0; }
  .meta { color: #444; font-size: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  td { padding: 1px 0; vertical-align: top; }
  td.num { direction: ltr; text-align: left; white-space: nowrap; }
  @media print { .no-print { display: none; } }
`;

function openPrintWindow(title: string, bodyHtml: string): boolean {
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${esc(title)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap" rel="stylesheet">
    <style>${PRINT_CSS}</style></head><body>${bodyHtml}
    <div class="center no-print" style="margin-top:8px">
      <button onclick="window.print()">🖨️ طباعة</button>
    </div>
    <script>window.onload = () => { window.print(); };</script>
    </body></html>`);
  win.document.close();
  return true;
}

export interface PosReceiptData {
  company?: PosPrintCompany | null;
  invoiceNumber: string;
  date: string;
  cashierName?: string;
  customerName?: string;
  lines: Array<{ nameAr: string; quantity: number; unitPrice: number; lineTotal: number; unit: string }>;
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  totalAmount: number;
  cashAmount: number;
  creditAmount: number;
  change: number;
  footer?: string;
  fmtCurrency: (v: number) => string;
}

/** Print a POS sale receipt (80mm). Returns false when popup blocked. */
export function printPosReceipt(data: PosReceiptData): boolean {
  const c = data.fmtCurrency;
  const rows = data.lines.map((l) => `
    <tr>
      <td colspan="2" class="bold">${esc(l.nameAr)}</td>
    </tr>
    <tr>
      <td class="meta">${esc(l.quantity)} × ${c(l.unitPrice)}${l.unit ? ' ' + esc(l.unit) : ''}</td>
      <td class="num">${c(l.lineTotal)}</td>
    </tr>`).join('');

  const body = `
    <div class="center bold big">${esc(data.company?.name || '')}</div>
    ${data.company?.taxNumber ? `<div class="center meta">الرقم الضريبي: ${esc(data.company.taxNumber)}</div>` : ''}
    ${data.company?.address ? `<div class="center meta">${esc(data.company.address)}</div>` : ''}
    ${data.company?.phone ? `<div class="center meta">${esc(data.company.phone)}</div>` : ''}
    <div class="line"></div>
    <div class="row"><span>إيصال نقطة بيع</span><span class="num">${esc(data.invoiceNumber)}</span></div>
    <div class="row"><span>التاريخ</span><span class="num">${esc(data.date)}</span></div>
    ${data.cashierName ? `<div class="row"><span>الكاشير</span><span>${esc(data.cashierName)}</span></div>` : ''}
    ${data.customerName ? `<div class="row"><span>العميل</span><span>${esc(data.customerName)}</span></div>` : ''}
    <div class="line"></div>
    <table>${rows}</table>
    <div class="line"></div>
    <div class="row"><span>الإجمالي قبل الضريبة</span><span class="num">${c(data.subtotal)}</span></div>
    ${data.discountAmount > 0 ? `<div class="row"><span>الخصم</span><span class="num">-${c(data.discountAmount)}</span></div>` : ''}
    ${data.vatAmount > 0 ? `<div class="row"><span>الضريبة</span><span class="num">${c(data.vatAmount)}</span></div>` : ''}
    <div class="row big bold"><span>الإجمالي</span><span class="num">${c(data.totalAmount)}</span></div>
    ${data.cashAmount > 0 ? `<div class="row"><span>نقدي</span><span class="num">${c(data.cashAmount)}</span></div>` : ''}
    ${data.creditAmount > 0 ? `<div class="row"><span>آجل</span><span class="num">${c(data.creditAmount)}</span></div>` : ''}
    ${data.change > 0 ? `<div class="row bold"><span>الباقي</span><span class="num">${c(data.change)}</span></div>` : ''}
    <div class="line"></div>
    ${data.footer ? `<div class="center">${esc(data.footer)}</div>` : ''}
    <div class="center meta">${esc(data.company?.name || '')}</div>
  `;
  return openPrintWindow(`إيصال ${data.invoiceNumber}`, body);
}

export interface PosZReportData {
  company?: PosPrintCompany | null;
  shift: PosShift;
  summary: PosShiftSummary;
  fmtCurrency: (v: number) => string;
}

/** Print the shift Z-report (80mm). Returns false when popup blocked. */
export function printPosZReport(data: PosZReportData): boolean {
  const { company, shift, summary } = data;
  const c = data.fmtCurrency;
  const diff = shift.difference ?? 0;
  const diffLabel = Math.abs(diff) < 0.005 ? 'مطابق' : diff > 0 ? 'زيادة' : 'نقص';

  const body = `
    <div class="center bold big">${esc(company?.name || '')}</div>
    <div class="center bold">تقرير إغلاق وردية (Z)</div>
    <div class="line"></div>
    <div class="row"><span>الصندوق</span><span>${esc(shift.cashBoxName || '-')}</span></div>
    <div class="row"><span>الكاشير</span><span>${esc(shift.cashierName || '-')}</span></div>
    <div class="row"><span>الفتح</span><span class="num">${esc(shift.openedAt?.slice(0, 16).replace('T', ' ') || '-')}</span></div>
    <div class="row"><span>الإغلاق</span><span class="num">${shift.closedAt ? esc(shift.closedAt.slice(0, 16).replace('T', ' ')) : '-'}</span></div>
    <div class="line"></div>
    <div class="row"><span>عدد الفواتير</span><span class="num bold">${esc(summary.invoicesCount)}</span></div>
    <div class="row"><span>إجمالي المبيعات</span><span class="num">${c(summary.netTotal)}</span></div>
    <div class="row"><span>الخصومات</span><span class="num">${c(summary.discountAmount)}</span></div>
    <div class="row"><span>الضريبة</span><span class="num">${c(summary.vatAmount)}</span></div>
    <div class="line"></div>
    <div class="row"><span>دفعات نقدية</span><span class="num">${c(summary.cashTotal)}</span></div>
    <div class="row"><span>مبالغ آجلة</span><span class="num">${c(summary.creditTotal)}</span></div>
    <div class="line"></div>
    <div class="row"><span>الرصيد الافتتاحي</span><span class="num">${c(summary.openingAmount)}</span></div>
    <div class="row bold"><span>المتوقع بالصندوق</span><span class="num">${c(summary.expectedAmount)}</span></div>
    <div class="row"><span>المعدود فعلياً</span><span class="num">${shift.closingAmount != null ? c(shift.closingAmount) : '-'}</span></div>
    <div class="row big bold"><span>الفرق (${diffLabel})</span><span class="num">${c(diff)}</span></div>
    ${shift.notes ? `<div class="line"></div><div class="meta">ملاحظات: ${esc(shift.notes)}</div>` : ''}
  `;
  return openPrintWindow('تقرير Z', body);
}

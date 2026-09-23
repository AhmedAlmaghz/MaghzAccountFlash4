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

function openPrintWindow(title: string, bodyHtml: string, t?: PosPrintT): boolean {
  const win = window.open('', '_blank');
  if (!win) return false;
  const printLabel = t ? t('pos.receipt.printButton', { default: '🖨️ طباعة' }) : '🖨️ طباعة';
  win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${esc(title)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap" rel="stylesheet">
    <style>${PRINT_CSS}</style></head><body>${bodyHtml}
    <div class="center no-print" style="margin-top:8px">
      <button onclick="window.print()">${printLabel}</button>
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

export type PosPrintT = (key: string, params?: Record<string, string | number>) => string;

/** Print a POS sale receipt (80mm). Returns false when popup blocked. */
export function printPosReceipt(data: PosReceiptData, t?: PosPrintT): boolean {
  const T = (key: string, fallback: string): string =>
    t ? t(key, { default: fallback }) : fallback;
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
    ${data.company?.taxNumber ? `<div class="center meta">${T('pos.receipt.taxNumber', 'الرقم الضريبي:')} ${esc(data.company.taxNumber)}</div>` : ''}
    ${data.company?.address ? `<div class="center meta">${esc(data.company.address)}</div>` : ''}
    ${data.company?.phone ? `<div class="center meta">${esc(data.company.phone)}</div>` : ''}
    <div class="line"></div>
    <div class="row"><span>${T('pos.receipt.title', 'إيصال نقطة بيع')}</span><span class="num">${esc(data.invoiceNumber)}</span></div>
    <div class="row"><span>${T('pos.receipt.date', 'التاريخ')}</span><span class="num">${esc(data.date)}</span></div>
    ${data.cashierName ? `<div class="row"><span>${T('pos.receipt.cashier', 'الكاشير')}</span><span>${esc(data.cashierName)}</span></div>` : ''}
    ${data.customerName ? `<div class="row"><span>${T('pos.receipt.customer', 'العميل')}</span><span>${esc(data.customerName)}</span></div>` : ''}
    <div class="line"></div>
    <table>${rows}</table>
    <div class="line"></div>
    <div class="row"><span>${T('pos.receipt.subtotal', 'الإجمالي قبل الضريبة')}</span><span class="num">${c(data.subtotal)}</span></div>
    ${data.discountAmount > 0 ? `<div class="row"><span>${T('pos.receipt.discount', 'الخصم')}</span><span class="num">-${c(data.discountAmount)}</span></div>` : ''}
    ${data.vatAmount > 0 ? `<div class="row"><span>${T('pos.receipt.vat', 'الضريبة')}</span><span class="num">${c(data.vatAmount)}</span></div>` : ''}
    <div class="row big bold"><span>${T('pos.receipt.total', 'الإجمالي')}</span><span class="num">${c(data.totalAmount)}</span></div>
    ${data.cashAmount > 0 ? `<div class="row"><span>${T('pos.receipt.cash', 'نقدي')}</span><span class="num">${c(data.cashAmount)}</span></div>` : ''}
    ${data.creditAmount > 0 ? `<div class="row"><span>${T('pos.receipt.credit', 'آجل')}</span><span class="num">${c(data.creditAmount)}</span></div>` : ''}
    ${data.change > 0 ? `<div class="row bold"><span>${T('pos.receipt.change', 'الباقي')}</span><span class="num">${c(data.change)}</span></div>` : ''}
    <div class="line"></div>
    ${data.footer ? `<div class="center">${esc(data.footer)}</div>` : ''}
    <div class="center meta">${esc(data.company?.name || '')}</div>
  `;
  return openPrintWindow(`${T('pos.receipt.docPrefix', 'إيصال')} ${data.invoiceNumber}`, body, t);
}

export interface PosZReportData {
  company?: PosPrintCompany | null;
  shift: PosShift;
  summary: PosShiftSummary;
  fmtCurrency: (v: number) => string;
}

/** Print the shift Z-report (80mm). Returns false when popup blocked. */
export function printPosZReport(data: PosZReportData, t?: PosPrintT): boolean {
  const T = (key: string, fallback: string): string =>
    t ? t(key, { default: fallback }) : fallback;
  const { company, shift, summary } = data;
  const c = data.fmtCurrency;
  const diff = shift.difference ?? 0;
  const diffLabel = Math.abs(diff) < 0.005 ? T('pos.receipt.matched', 'مطابق') : diff > 0 ? T('pos.receipt.surplus', 'زيادة') : T('pos.receipt.shortage', 'نقص');

  const body = `
    <div class="center bold big">${esc(company?.name || '')}</div>
    <div class="center bold">${T('pos.receipt.zTitle', 'تقرير إغلاق وردية (Z)')}</div>
    <div class="line"></div>
    <div class="row"><span>${T('pos.receipt.cashBox', 'الصندوق')}</span><span>${esc(shift.cashBoxName || '-')}</span></div>
    <div class="row"><span>${T('pos.receipt.cashier', 'الكاشير')}</span><span>${esc(shift.cashierName || '-')}</span></div>
    <div class="row"><span>${T('pos.receipt.openedAt', 'الفتح')}</span><span class="num">${esc(shift.openedAt?.slice(0, 16).replace('T', ' ') || '-')}</span></div>
    <div class="row"><span>${T('pos.receipt.closedAt', 'الإغلاق')}</span><span class="num">${shift.closedAt ? esc(shift.closedAt.slice(0, 16).replace('T', ' ')) : '-'}</span></div>
    <div class="line"></div>
    <div class="row"><span>${T('pos.receipt.invoicesCount', 'عدد الفواتير')}</span><span class="num bold">${esc(summary.invoicesCount)}</span></div>
    <div class="row"><span>${T('pos.receipt.netTotal', 'إجمالي المبيعات')}</span><span class="num">${c(summary.netTotal)}</span></div>
    <div class="row"><span>${T('pos.receipt.discountTotal', 'الخصومات')}</span><span class="num">${c(summary.discountAmount)}</span></div>
    <div class="row"><span>${T('pos.receipt.vatTotal', 'الضريبة')}</span><span class="num">${c(summary.vatAmount)}</span></div>
    <div class="line"></div>
    <div class="row"><span>${T('pos.receipt.cashTotal', 'دفعات نقدية')}</span><span class="num">${c(summary.cashTotal)}</span></div>
    <div class="row"><span>${T('pos.receipt.creditTotal', 'مبالغ آجلة')}</span><span class="num">${c(summary.creditTotal)}</span></div>
    <div class="line"></div>
    <div class="row"><span>${T('pos.receipt.opening', 'الرصيد الافتتاحي')}</span><span class="num">${c(summary.openingAmount)}</span></div>
    <div class="row bold"><span>${T('pos.receipt.expected', 'المتوقع بالصندوق')}</span><span class="num">${c(summary.expectedAmount)}</span></div>
    <div class="row"><span>${T('pos.receipt.counted', 'المعدود فعلياً')}</span><span class="num">${shift.closingAmount != null ? c(shift.closingAmount) : '-'}</span></div>
    <div class="row big bold"><span>${T('pos.receipt.difference', 'الفرق')} (${diffLabel})</span><span class="num">${c(diff)}</span></div>
    ${shift.notes ? `<div class="line"></div><div class="meta">${T('pos.receipt.notes', 'ملاحظات:')} ${esc(shift.notes)}</div>` : ''}
  `;
  return openPrintWindow(T('pos.receipt.zDocTitle', 'تقرير Z'), body, t);
}

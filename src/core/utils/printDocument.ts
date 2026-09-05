import { escapeHtml } from '@/core/utils/html';
import { formatDateValue, getCompanyDecimalPlaces } from '@/core/utils/locale';

export interface PrintLine {
  description: string;
  productCode?: string;
  productName?: string;
  barcode?: string;
  sku?: string;
  unit?: string;
  quantity?: number;
  unitPrice?: number;
  discount?: number;
  total: number;
}

export interface StatementLine {
  date: string;
  docNumber: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface PrintDocumentData {
  type: 'sales-invoice' | 'purchase-invoice' | 'purchase-order' | 'purchase-return' | 'sales-return' | 'quotation' | 'receipt-voucher' | 'payment-voucher' | 'journal-entry' | 'ledger' | 'statement';
  docNumber: string;
  date: string;
  dueDate?: string;
  cashBoxName?: string;
  partyName: string;
  partyLabel: string;
  partyTaxNumber?: string;
  partyAddress?: string;
  lines: PrintLine[];
  statementLines?: StatementLine[];
  subtotal: number;
  discountAmount?: number;
  vatAmount: number;
  totalAmount: number;
  notes?: string;
  companyName?: string;
  companyTaxNumber?: string;
  companyVatNumber?: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyLogoUrl?: string;
  vatRate?: number;
  currency?: string;
  paymentType?: string;
  paymentMethod?: string;
  checkNumber?: string;
  checkDate?: string;
  createdBy?: string;
  approvedBy?: string;
}

const typeTitles: Record<string, string> = {
  'sales-invoice': 'فاتورة ضريبية',
  'purchase-invoice': 'فاتورة مشتريات',
  'purchase-order': 'أمر شراء',
  'purchase-return': 'مردود مشتريات',
  'sales-return': 'مردود مبيعات',
  'quotation': 'عرض سعر',
  'receipt-voucher': 'سند قبض',
  'payment-voucher': 'سند صرف',
  'journal-entry': 'قيد يومية',
  'ledger': 'كشف حساب',
  'statement': 'كشف حساب',
};

const typeColors: Record<string, string> = {
  'sales-invoice': '#1e40af',
  'purchase-invoice': '#0f766e',
  'purchase-order': '#7c3aed',
  'purchase-return': '#be185d',
  'sales-return': '#be185d',
  'quotation': '#f59e0b',
  'receipt-voucher': '#047857',
  'payment-voucher': '#b45309',
  'journal-entry': '#6b7280',
  'ledger': '#6b7280',
  'statement': '#0f766e',
};

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

function toArabicDigits(num: number): string {
  return num.toString().replace(/\d/g, d => ARABIC_DIGITS[parseInt(d)]);
}

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const TENS = ['', 'عشرة', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مئة', 'مئتان', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];


function numberToWords(n: number): string {
  if (n === 0) return 'صفر';
  if (n < 0) return 'سالب ' + numberToWords(Math.abs(n));

  const intPart = Math.floor(n);
  const fracPart = Math.round((n - intPart) * 10 ** getCompanyDecimalPlaces());

  let result = '';

  const billions = Math.floor(intPart / 1000000000);
  const millions = Math.floor((intPart % 1000000000) / 1000000);
  const thousands = Math.floor((intPart % 1000000) / 1000);
  const remainder = intPart % 1000;

  if (billions > 0) {
    result += convertHundreds(billions) + ' ';
    if (billions === 1) result += 'مليار ';
    else if (billions === 2) result += 'ملياران ';
    else result += 'مليارات ';
  }

  if (millions > 0) {
    result += convertHundreds(millions) + ' ';
    if (millions === 1) result += 'مليون ';
    else if (millions === 2) result += 'مليونان ';
    else result += 'ملايين ';
  }

  if (thousands > 0) {
    result += convertHundreds(thousands) + ' ';
    if (thousands === 1) result += 'ألف ';
    else if (thousands === 2) result += 'ألفان ';
    else result += 'آلاف ';
  }

  if (remainder > 0) {
    result += convertHundreds(remainder);
  }

  if (fracPart > 0) {
    result += ' فاصلة ' + numberToWords(fracPart);
  }

  return result.trim();
}

function convertHundreds(n: number): string {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  let result = '';

  if (h > 0) {
    if (h === 1) result += 'مئة ';
    else if (h === 2) result += 'مئتان ';
    else result += HUNDREDS[h] + ' ';
  }

  if (t > 0 || o > 0) {
    if (t === 1 && o > 0) {
      if (o === 1) result += 'أحد عشر';
      else if (o === 2) result += 'اثنا عشر';
      else result += ONES[o] + ' عشر';
    } else {
      if (o > 0) {
        if (o === 2 && t === 0 && h === 0) result += 'اثنان';
        else result += ONES[o] + ' ';
      }
      if (t > 0) {
        if (t === 1 && o === 0) result += 'عشرة';
        else result += TENS[t];
      }
    }
  }

  return result.trim();
}

function formatCurrency(amount: number, currency = 'YER'): string {
  const symbol = currency === 'YER' ? 'ر.ي' : currency;
  const dp = getCompanyDecimalPlaces();
  return `${new Intl.NumberFormat('ar-YE', { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(amount)} ${symbol}`;
}

function escapeLineBreaks(value: string): string {
  return escapeHtml(value).replaceAll('\n', '<br />');
}

function generateHtml(data: PrintDocumentData): string {
  const color = typeColors[data.type];
  const title = typeTitles[data.type];
  const isInvoice = data.type === 'sales-invoice' || data.type === 'purchase-invoice' || data.type === 'purchase-order' || data.type === 'purchase-return' || data.type === 'sales-return' || data.type === 'quotation';
  const isVoucher = data.type === 'receipt-voucher' || data.type === 'payment-voucher';
  const isStatement = data.type === 'statement';
  const amountWords = numberToWords(data.totalAmount);
  const currencyName = data.currency === 'YER' ? 'ريال يمني' : data.currency;
  const amountInWords = `${amountWords} ${currencyName} فقط لا غير`;

  const linesHtml = isStatement && data.statementLines
    ? data.statementLines.map((sl, i) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:12px;color:#6b7280">${toArabicDigits(i + 1)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:12px">${formatDateValue(sl.date)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:12px">${escapeHtml(sl.docNumber)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:12px">${escapeHtml(sl.description)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:12px;direction:ltr;color:#059669">${sl.debit > 0 ? new Intl.NumberFormat('ar-YE').format(sl.debit) : '-'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:12px;direction:ltr;color:#dc2626">${sl.credit > 0 ? new Intl.NumberFormat('ar-YE').format(sl.credit) : '-'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:13px;font-weight:700;direction:ltr">${new Intl.NumberFormat('ar-YE').format(sl.balance)}</td>
    </tr>
    `).join('')
    : data.lines.map((line, i) => {
    const meta = [line.productCode, line.barcode, line.sku, line.unit].filter(Boolean).join(' • ');
    const descBlock = meta
      ? `<div style="font-size:10px;color:#6b7280;margin-top:2px">${escapeLineBreaks(meta)}</div>`
      : '';
    return `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:12px;color:#6b7280">${toArabicDigits(i + 1)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:13px">
        <div style="font-weight:600">${escapeLineBreaks(line.description)}</div>
        ${descBlock}
      </td>
      ${isInvoice ? `
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:12px">${line.unit || '-'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:12px">${line.quantity != null ? toArabicDigits(line.quantity) : '-'}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:12px;direction:ltr">${line.unitPrice != null ? new Intl.NumberFormat('ar-YE').format(line.unitPrice) : '-'}</td>
        ${line.discount != null && line.discount > 0 ? `<td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:12px;direction:ltr;color:#dc2626">${new Intl.NumberFormat('ar-YE').format(line.discount)}</td>` : ''}
      ` : ''}
      <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:13px;font-weight:700;direction:ltr">${new Intl.NumberFormat('ar-YE').format(line.total)}</td>
    </tr>
  `;
  }).join('');

  const colCount = isStatement ? 7 : isInvoice ? (data.lines.some(l => l.discount != null && l.discount > 0) ? 7 : 6) : 2;

  const closingBalance = isStatement && data.statementLines && data.statementLines.length > 0
    ? data.statementLines[data.statementLines.length - 1].balance
    : null;

  const totalsHtml = isInvoice ? `
    <div style="width:52%;margin-right:auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
      <div style="background:linear-gradient(135deg, ${color} 0%, ${color}dd 100%);color:white;padding:10px 14px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700;font-size:13px;letter-spacing:0.5px">ملخص الفاتورة</span>
        <span style="font-size:11px;opacity:0.9;background:rgba(255,255,255,0.15);padding:3px 8px;border-radius:20px">${data.lines.length} صنف</span>
      </div>
      <div style="padding:12px 14px">
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #e5e7eb;font-size:13px">
          <span style="color:#6b7280;display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;background:#e5e7eb;border-radius:50%;display:inline-block"></span> المجموع الفرعي</span>
          <span style="font-weight:600;direction:ltr">${formatCurrency(data.subtotal, data.currency)}</span>
        </div>
        ${data.discountAmount != null && data.discountAmount > 0 ? `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #e5e7eb;font-size:13px;background:#fef3c7;margin:0 -14px;padding-left:14px;padding-right:14px">
          <span style="color:#92400e;display:flex;align-items:center;gap:6px">٪ الخصم <span style="font-size:11px;background:#f59e0b;color:white;padding:1px 6px;border-radius:10px">${((data.discountAmount / (data.subtotal || 1)) * 100).toFixed(1)}%</span></span>
          <span style="font-weight:700;direction:ltr;color:#b45309">-${formatCurrency(data.discountAmount, data.currency)}</span>
        </div>
        ` : ''}
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #e5e7eb;font-size:13px">
          <span style="color:#6b7280;display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;background:#10b981;border-radius:50%;display:inline-block"></span> ضريبة القيمة المضافة <span style="font-size:11px;background:#ecfdf5;color:#047857;padding:1px 6px;border-radius:10px">${data.vatRate ?? 15}%</span></span>
          <span style="font-weight:600;direction:ltr;color:#047857">${formatCurrency(data.vatAmount, data.currency)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;margin:8px -14px -12px;background:${color};color:white;border-radius:0 0 10px 10px">
          <span style="font-weight:800;font-size:14px;letter-spacing:0.3px">الإجمالي النهائي</span>
          <span style="font-weight:800;font-size:16px;direction:ltr;letter-spacing:0.5px">${formatCurrency(data.totalAmount, data.currency)}</span>
        </div>
      </div>
      <div style="padding:8px 14px;background:#f9fafb;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:11px;color:#6b7280">
        <span>المبلغ بالحروف:</span>
        <span style="font-weight:600;color:#374151;direction:ltr">${escapeHtml(amountInWords)}</span>
      </div>
    </div>
  ` : `
    <div style="margin-top:20px;background:linear-gradient(135deg, ${color} 0%, ${color}dd 100%);border-radius:10px;padding:16px;color:white;display:flex;justify-content:space-between;align-items:center;box-shadow:0 4px 6px rgba(0,0,0,0.1)">
      <span style="font-size:13px;font-weight:600;opacity:0.9">المبلغ الإجمالي</span>
      <span style="font-size:18px;font-weight:800;direction:ltr;letter-spacing:0.5px">${formatCurrency(data.totalAmount, data.currency)}</span>
    </div>
  `;

  const paymentInfoHtml = !isStatement && (data.cashBoxName || data.paymentMethod) ? `
    <div style="margin-top:16px">
      <h4 style="font-size:12px;font-weight:700;color:#374151;margin-bottom:8px;padding-bottom:4px;border-bottom:2px solid ${color};display:inline-block">معلومات الدفع</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;color:#4b5563;margin-top:8px">
        ${data.paymentType ? `<div><span style="color:#6b7280">نوع الدفع:</span> ${escapeHtml(data.paymentType)}</div>` : ''}
        ${data.paymentMethod ? `<div><span style="color:#6b7280">طريقة الدفع:</span> ${escapeHtml(data.paymentMethod)}</div>` : ''}
        ${data.cashBoxName ? `<div><span style="color:#6b7280">الخزنة:</span> ${escapeHtml(data.cashBoxName)}</div>` : ''}
        ${data.checkNumber ? `<div><span style="color:#6b7280">رقم الشيك:</span> ${escapeHtml(data.checkNumber)}</div>` : ''}
        ${data.checkDate ? `<div><span style="color:#6b7280">تاريخ الشيك:</span> ${escapeHtml(data.checkDate)}</div>` : ''}
      </div>
    </div>
  ` : '';

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)} - ${escapeHtml(data.docNumber)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    @page { margin: 15mm; size: A4; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Cairo', 'Tahoma', sans-serif;
      background: #f3f4f6;
      padding: 20px;
      color: #1f2937;
      font-size: 13px;
      line-height: 1.6;
    }
    .page {
      max-width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      background: white;
      box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08);
      position: relative;
    }
    .page-inner {
      padding: 30px 35px 20px;
    }
    .watermark {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-30deg);
      font-size: 120px;
      font-weight: 900;
      color: rgba(0,0,0,0.03);
      pointer-events: none;
      white-space: nowrap;
      z-index: 0;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 20px;
      border-bottom: 3px solid ${color};
      margin-bottom: 20px;
      position: relative;
      z-index: 1;
    }
    .company-section {
      flex: 1;
    }
    .company-name {
      font-size: 22px;
      font-weight: 800;
      color: ${color};
      letter-spacing: -0.5px;
    }
    .company-details {
      margin-top: 6px;
      font-size: 11px;
      color: #6b7280;
      line-height: 1.8;
    }
    .company-details span {
      display: block;
    }
    .doc-badge {
      text-align: center;
      min-width: 160px;
    }
    .doc-badge .badge {
      display: inline-block;
      background: ${color};
      color: white;
      padding: 10px 28px;
      font-weight: 800;
      font-size: 16px;
      letter-spacing: 1px;
      border-radius: 4px;
    }
    .doc-badge .number {
      margin-top: 6px;
      font-size: 14px;
      font-weight: 700;
      color: #374151;
    }
    .meta-section {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 20px;
      position: relative;
      z-index: 1;
    }
    .meta-card {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 12px 14px;
    }
    .meta-card.party {
      grid-column: 1;
    }
    .meta-card.dates {
      grid-column: 2;
    }
    .meta-label {
      font-size: 10px;
      font-weight: 700;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 2px;
    }
    .meta-value {
      font-size: 14px;
      font-weight: 600;
      color: #1f2937;
    }
    .meta-value.small {
      font-size: 12px;
      font-weight: 400;
      color: #6b7280;
    }
    .amount-words {
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 16px;
      font-size: 13px;
      color: #92400e;
      position: relative;
      z-index: 1;
    }
    .amount-words .label {
      font-weight: 700;
      font-size: 11px;
      color: #b45309;
    }
    .amount-words .text {
      font-weight: 600;
      font-size: 14px;
    }
    table.items {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-bottom: 16px;
      position: relative;
      z-index: 1;
    }
    table.items thead th {
      background: ${color};
      color: white;
      padding: 10px 10px;
      font-weight: 700;
      font-size: 12px;
      text-align: center;
      border: none;
    }
    table.items thead th:first-child {
      border-radius: 0 6px 0 0;
    }
    table.items thead th:last-child {
      border-radius: 6px 0 0 0;
    }
    table.items tbody tr:nth-child(even) {
      background: #f9fafb;
    }
    table.items tbody tr:hover {
      background: #f3f4f6;
    }
    .notes-section {
      margin-top: 12px;
      font-size: 12px;
      color: #6b7280;
      background: #f9fafb;
      padding: 10px 14px;
      border-radius: 6px;
      border-right: 3px solid ${color};
      position: relative;
      z-index: 1;
    }
    .notes-section strong {
      color: #374151;
    }
    .signatures {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 20px;
      margin-top: 36px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      position: relative;
      z-index: 1;
    }
    .sig-item {
      text-align: center;
    }
    .sig-line {
      border-top: 1px solid #d1d5db;
      margin-top: 40px;
      padding-top: 8px;
      font-size: 11px;
      color: #9ca3af;
    }
    .footer {
      margin-top: 24px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
      font-size: 10px;
      color: #9ca3af;
      text-align: center;
      position: relative;
      z-index: 1;
    }
    .footer .divider {
      margin: 0 8px;
      color: #d1d5db;
    }
    .print-btn {
      text-align: center;
      margin-top: 24px;
      position: relative;
      z-index: 1;
    }
    .print-btn button {
      padding: 12px 40px;
      background: ${color};
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-family: 'Cairo', sans-serif;
      font-size: 14px;
      font-weight: 700;
      transition: all 0.2s;
      box-shadow: 0 2px 4px rgba(0,0,0,0.15);
    }
    .print-btn button:hover {
      opacity: 0.9;
      transform: translateY(-1px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.2);
    }
    .qr-section {
      position: absolute;
      bottom: 20px;
      left: 30px;
      width: 60px;
      height: 60px;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 8px;
      color: #9ca3af;
    }
    @media print {
      body { background: white; padding: 0; }
      .page { box-shadow: none; max-width: 100%; }
      .print-btn { display: none !important; }
      .page-inner { padding: 15mm; }
    }
    @media screen and (max-width: 768px) {
      body { padding: 8px; }
      .page-inner { padding: 16px; }
      .header { flex-direction: column; gap: 12px; }
      .doc-badge { text-align: right; }
      .meta-section { grid-template-columns: 1fr; }
      .meta-card.party, .meta-card.dates { grid-column: 1; }
      .signatures { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="watermark">${escapeHtml(data.companyName || '')}</div>
    <div class="page-inner">
      <div class="header">
        <div class="company-section">
          ${data.companyLogoUrl ? `<img src="${data.companyLogoUrl}" alt="logo" style="width:64px;height:64px;object-fit:contain;border:1px solid #e5e7eb;border-radius:10px;padding:4px;margin-bottom:8px" />` : ''}
          <div class="company-name">${escapeHtml(data.companyName || 'الشركة')}</div>
          <div class="company-details">
            ${data.companyTaxNumber ? `<span>الرقم الضريبي: ${escapeHtml(data.companyTaxNumber)}</span>` : ''}
            ${data.companyVatNumber ? `<span>رقم ضريبة القيمة المضافة: ${escapeHtml(data.companyVatNumber)}</span>` : ''}
            ${data.companyAddress ? `<span>${escapeHtml(data.companyAddress)}</span>` : ''}
            ${data.companyPhone ? `<span>هاتف: ${escapeHtml(data.companyPhone)}</span>` : ''}
            ${data.companyEmail ? `<span>بريد إلكتروني: ${escapeHtml(data.companyEmail)}</span>` : ''}
          </div>
        </div>
        <div class="doc-badge">
          <div class="badge">${escapeHtml(title)}</div>
          <div class="number">رقم: ${escapeHtml(data.docNumber)}</div>
        </div>
      </div>

      <div class="meta-section">
        <div class="meta-card party">
          <div class="meta-label">${escapeHtml(data.partyLabel)}</div>
          <div class="meta-value">${escapeHtml(data.partyName)}</div>
          ${data.partyTaxNumber ? `<div class="meta-value small">الرقم الضريبي: ${escapeHtml(data.partyTaxNumber)}</div>` : ''}
          ${data.partyAddress ? `<div class="meta-value small">${escapeHtml(data.partyAddress)}</div>` : ''}
        </div>
        <div class="meta-card dates">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span>
              <div class="meta-label">تاريخ المستند</div>
              <div class="meta-value">${formatDateValue(data.date)}</div>
            </span>
            ${data.dueDate ? `
            <span style="text-align:left">
              <div class="meta-label">تاريخ الاستحقاق</div>
              <div class="meta-value">${formatDateValue(data.dueDate)}</div>
            </span>
            ` : ''}
          </div>
          ${data.createdBy ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #e5e7eb"><span class="meta-label">أنشئ بواسطة</span> <span class="meta-value" style="font-size:12px">${escapeHtml(data.createdBy)}</span></div>` : ''}
          ${data.approvedBy ? `<div><span class="meta-label">اعتمد بواسطة</span> <span class="meta-value" style="font-size:12px">${escapeHtml(data.approvedBy)}</span></div>` : ''}
        </div>
      </div>

      ${!isStatement ? `
      <div class="amount-words">
        <div class="label">المبلغ بالكتابة</div>
        <div class="text">${escapeHtml(amountInWords)}</div>
      </div>
      ` : ''}

      <table class="items">
        <thead>
          <tr>
            ${isStatement ? `
            <th style="width:30px">#</th>
            <th style="width:90px">التاريخ</th>
            <th style="width:100px">رقم المستند</th>
            <th style="text-align:right;min-width:200px">البيان</th>
            <th style="width:100px">مدين</th>
            <th style="width:100px">دائن</th>
            <th style="width:110px">الرصيد</th>
            ` : `
            <th style="width:30px">#</th>
            <th style="text-align:right">البيان</th>
            ${isInvoice ? `
            <th style="width:50px">الوحدة</th>
            <th style="width:60px">الكمية</th>
            <th style="width:80px">سعر الوحدة</th>
            ${data.lines.some(l => l.discount != null && l.discount > 0) ? '<th style="width:70px">الخصم</th>' : ''}
            ` : ''}
            <th style="width:90px">الإجمالي</th>
            `}
          </tr>
        </thead>
        <tbody>
          ${linesHtml}
          ${data.lines.length === 0 ? `
          <tr>
            <td colspan="${colCount}" style="padding:20px;text-align:center;color:#9ca3af;font-size:13px">لا توجد بنود</td>
          </tr>
          ` : ''}
        </tbody>
      </table>

      ${totalsHtml}

      ${paymentInfoHtml}

      ${!isStatement && data.notes ? `<div class="notes-section"><strong>ملاحظات:</strong><br>${escapeLineBreaks(data.notes)}</div>` : ''}

      ${isVoucher ? `
      <div class="notes-section" style="background:#f0fdf4;border-right-color:#16a34a">
        <strong>بيان السند:</strong><br>
        ${escapeHtml(data.notes || data.lines[0]?.description || '')}
      </div>
      ` : ''}

      ${isStatement && closingBalance !== null ? `
      <div class="amount-words" style="background:#f0fdf4;border-color:#86efac">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div class="label">الرصيد الختامي</div>
            <div class="text" style="color:#059669">${formatCurrency(closingBalance, data.currency)}</div>
          </div>
          <div style="text-align:left">
            <div class="label">إجمالي المدين</div>
            <div class="text" style="color:#059669">${formatCurrency(data.subtotal, data.currency)}</div>
          </div>
          <div style="text-align:left">
            <div class="label">إجمالي الدائن</div>
            <div class="text" style="color:#dc2626">${formatCurrency(data.vatAmount, data.currency)}</div>
          </div>
        </div>
      </div>
      ` : ''}

      <div class="signatures">
        <div class="sig-item">
          <div class="sig-line">توقيع المستلم</div>
        </div>
        <div class="sig-item">
          <div class="sig-line">المدير المالي</div>
        </div>
        <div class="sig-item">
          <div class="sig-line">الختم الرسمي</div>
        </div>
      </div>

      <div class="footer">
        تم إنشاء هذا المستند إلكترونياً بواسطة نظام MaghzAccount
        <span class="divider">|</span>
        مستند رقم ${escapeHtml(data.docNumber)}
        <span class="divider">|</span>
        تاريخ ${formatDateValue(data.date)}
      </div>
    </div>
  </div>

  <div class="print-btn">
    <button onclick="window.print()">
      🖨️ طباعة / حفظ PDF
    </button>
  </div>
</body>
</html>
  `;
}

export function printDocument(data: PrintDocumentData, autoPrint = false): void {
  const html = generateHtml(data);
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('يرجى السماح بفتح النوافذ المنبثقة للطباعة');
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  if (autoPrint) {
    setTimeout(() => printWindow.print(), 600);
  }
}

import type { PrintDocumentData, PrintLine, PrintT } from './printDocument';
import { printDocument, generateHtml } from './printDocument';
import { printHtmlDocument } from '@/core/reports/pdf/reportPdfExporter';
import { exportToExcel, type ExportColumn } from './exportEngine';

/** The line shape every document editor works with. */
export interface EditorLine {
  productName: string;
  productCode?: string;
  barcode?: string;
  sku?: string;
  unitName?: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  lineTotal?: number;
}

/** Everything print/export needs, assembled from an editor's live form state. */
export interface EditorDocumentData {
  type: PrintDocumentData['type'];
  docNumber: string;
  date: string;
  dueDate?: string;
  partyName: string;
  partyLabel: string;
  partyTaxNumber?: string;
  partyAddress?: string;
  lines: EditorLine[];
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  totalAmount: number;
  notes?: string;
  currency?: string;
  vatRate?: number;
  paymentType?: string;
  statusBadge?: string;
  statusTone?: PrintDocumentData['statusTone'];
  /** Paper reference number shown on the printed/PDF document. */
  reference?: string;
  company?: {
    name?: string;
    taxNumber?: string;
    address?: string;
    phone?: string;
    email?: string;
    logoUrl?: string;
  };
}

function toPrintLines(lines: EditorLine[]): PrintLine[] {
  return lines.map((l) => ({
    description: l.productName,
    productCode: l.productCode,
    productName: l.productName,
    barcode: l.barcode,
    sku: l.sku,
    unit: l.unitName,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discount: l.discountPercent || 0,
    total: l.lineTotal ?? l.quantity * l.unitPrice * (1 - (l.discountPercent || 0) / 100),
  }));
}

function buildPrintData(d: EditorDocumentData): PrintDocumentData {
  return {
    type: d.type,
    docNumber: d.docNumber,
    date: d.date,
    dueDate: d.dueDate,
    partyName: d.partyName,
    partyLabel: d.partyLabel,
    partyTaxNumber: d.partyTaxNumber,
    partyAddress: d.partyAddress,
    lines: toPrintLines(d.lines),
    subtotal: d.subtotal,
    discountAmount: d.discountAmount,
    vatAmount: d.vatAmount,
    totalAmount: d.totalAmount,
    notes: d.notes,
    currency: d.currency,
    vatRate: d.vatRate,
    paymentType: d.paymentType,
    companyName: d.company?.name,
    companyTaxNumber: d.company?.taxNumber,
    companyAddress: d.company?.address,
    companyPhone: d.company?.phone,
    companyEmail: d.company?.email,
    companyLogoUrl: d.company?.logoUrl,
    statusBadge: d.statusBadge,
    statusTone: d.statusTone,
    reference: d.reference,
  };
}

function exportColumns(t: PrintT): ExportColumn[] {
  return [
    { key: 'productName', header: t('inventory.products.nameAr', { default: 'المنتج' }), width: 26 },
    { key: 'productCode', header: t('inventory.product.code', { default: 'الكود' }), width: 14 },
    { key: 'quantity', header: t('common.quantity', { default: 'الكمية' }), width: 10 },
    { key: 'unitPrice', header: t('common.unitPrice', { default: 'سعر الوحدة' }), width: 14 },
    { key: 'discountPercent', header: t('sales.discount', { default: 'الخصم' }), width: 10 },
    { key: 'lineTotal', header: t('common.total', { default: 'الإجمالي' }), width: 14 },
  ];
}

function exportRows(d: EditorDocumentData): Record<string, unknown>[] {
  return d.lines.map((l) => ({
    productName: l.productName,
    productCode: l.productCode ?? '',
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discountPercent: l.discountPercent || 0,
    lineTotal: l.lineTotal ?? l.quantity * l.unitPrice * (1 - (l.discountPercent || 0) / 100),
  }));
}

/** Print the document exactly as it appears in the editor. */
export function printEditorDocument(d: EditorDocumentData, t: PrintT): void {
  printDocument(buildPrintData(d), false, t);
}

/** Export the document's lines to Excel. */
export function exportEditorExcel(d: EditorDocumentData, t: PrintT): void {
  const rows = exportRows(d);
  void exportToExcel(rows, exportColumns(t), `${d.type}_${d.docNumber || 'draft'}`.replace(/[^\w-]+/g, '_'));
}

/**
 * Export the FULL document to PDF using the browser's native renderer.
 * jsPDF reshapes Arabic manually and jspdf-autotable v5 ignores `direction`,
 * which mirrored Arabic words — native rendering keeps RTL shaping correct.
 */
export async function exportEditorPdf(d: EditorDocumentData, t: PrintT): Promise<void> {
  const filename = `${d.type}_${d.docNumber || 'draft'}`.replace(/[^\w-]+/g, '_');
  printHtmlDocument(generateHtml(buildPrintData(d), t), `${filename}.pdf`);
}

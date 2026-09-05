import { parseFlexibleNumber } from '../../engine/argNormalizers';
import { coreApi } from '@/modules/core/api';
import { getDbAdapter } from '@/core/database/adapters';

/**
 * Shared helpers for ALL write-tool domains (Phase 77 split). Extracted
 * verbatim from the former monolithic writeTools.ts — one source of truth
 * for parsing, VAT lookup, line validation and confirmation summaries.
 */

export function num(v: unknown): number {
  // Flexible parsing: Arabic-Indic digits, thousands separators, currency words
  return parseFlexibleNumber(v) ?? 0;
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

import { roundMoney, getCompanyDecimalPlaces } from '@/core/utils/locale';

/**
 * Rounds a monetary value to the company's decimal places (0 allowed).
 * Kept under the historic `round2` name so all existing money call sites
 * inherit company precision with no call-site changes; the default is 2.
 */
const round2 = (v: number) => roundMoney(v);
export { round2 };

/**
 * Rich confirmation summary for document tools: line count + estimated
 * pre-VAT total, so the approval card shows real substance the user can
 * verify before consenting.
 */
export function summarizeDocLines(label: string, lines: unknown): string {
  const arr = Array.isArray(lines) ? (lines as Array<Record<string, unknown>>) : [];
  const total = round2(
    arr.reduce(
      (s, l) => s + (Number(l?.quantity) || 0) * (Number(l?.unitPrice) || 0) * (1 - (Number(l?.discountPercent) || 0) / 100),
      0,
    ),
  );
  const dp = getCompanyDecimalPlaces();
  const totalStr = new Intl.NumberFormat('ar-YE', { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(total);
  return `${label} — ${arr.length} أصناف — الإجمالي قبل الضريبة ≈ ${totalStr} ر.ي`;
}

/** Fetch the company VAT rate (falls back to 15%). */
export async function getVatRate(companyId: string): Promise<number> {
  const res = await coreApi.getVatSettings(companyId);
  const rate = res.success && res.data ? num(res.data.vatRate) : 0;
  return rate > 0 ? rate : 15;
}

export interface InvoiceTaxConfig {
  /** Effective VAT rate — 0 when the company disabled VAT on invoices. */
  vatRate: number;
  /** Mirrors settings `invoice.showVat` (default true). */
  showVat: boolean;
  /** Mirrors settings `invoice.showDiscount` (default true). */
  showDiscount: boolean;
}

/**
 * Invoice tax/display configuration for ONE company — the same flags the
 * invoice forms obey (`settings.invoice.showVat/showDiscount`, default
 * visible). Document tools MUST go through this instead of getVatRate
 * alone, otherwise the agent books VAT the company switched off.
 */
export async function getInvoiceTaxConfig(companyId: string): Promise<InvoiceTaxConfig> {
  let showVat = true;
  let showDiscount = true;
  try {
    const adapter = await getDbAdapter();
    const res = await adapter.query<{ key: string; value: string }>(
      `SELECT key, value FROM settings WHERE company_id = $1 AND key IN ('invoice.showVat', 'invoice.showDiscount')`,
      [companyId],
    );
    if (res.success && res.rows) {
      for (const row of res.rows) {
        if (row.key === 'invoice.showVat') showVat = row.value === 'true';
        if (row.key === 'invoice.showDiscount') showDiscount = row.value === 'true';
      }
    }
  } catch {
    // unreadable settings — fall back to visible (previous behavior)
  }
  const vatRate = showVat ? await getVatRate(companyId) : 0;
  return { vatRate, showVat, showDiscount };
}

export interface RawLine {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
}

export function parseLines(raw: unknown): RawLine[] | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'يجب تمرير صنف واحد على الأقل في lines' };
  const lines: RawLine[] = [];
  for (const item of raw) {
    const productId = str((item as Record<string, unknown>).productId);
    const quantity = num((item as Record<string, unknown>).quantity);
    const unitPrice = num((item as Record<string, unknown>).unitPrice);
    const discountPercent = num((item as Record<string, unknown>).discountPercent);
    if (!productId) return { error: 'كل صنف يحتاج productId — استخدم search.products لإيجاد المنتج' };
    if (quantity <= 0) return { error: 'الكمية يجب أن تكون أكبر من صفر' };
    if (unitPrice < 0) return { error: 'السعر لا يمكن أن يكون سالباً' };
    lines.push({ productId, quantity, unitPrice, discountPercent });
  }
  return lines;
}

export const LINES_SCHEMA = {
  type: 'array',
  description: 'أصناف الفاتورة. احصل على productId وسعر البيع من search.products',
  items: {
    type: 'object',
    properties: {
      productId: { type: 'string', description: 'معرف المنتج (من search.products)' },
      quantity: { type: 'number', description: 'الكمية' },
      unitPrice: { type: 'number', description: 'سعر الوحدة (سعر البيع من search.products)' },
      discountPercent: { type: 'number', description: 'نسبة الخصم 0-100 (اختياري)' },
    },
    required: ['productId', 'quantity', 'unitPrice'],
  },
};

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
 * verify before consenting. Lines that carry an explicit unit (unitName or
 * unitId the enrichment resolves) are listed with their unit so the user
 * never approves a blind factor ("كرتون (×12)" instead of a mystery ×12).
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
  const unitBits: string[] = [];
  for (const l of arr) {
    const un = l?.unitName || l?.unitId;
    if (un) unitBits.push(`${Number(l?.quantity) || 0} × ${String(un)}${un === l?.unitId ? '' : ''}`);
    if (unitBits.length >= 3) break;
  }
  const unitNote = unitBits.length > 0 ? ` — الوحدات: ${unitBits.join('، ')}` : '';
  return `${label} — ${arr.length} أصناف — الإجمالي قبل الضريبة ≈ ${totalStr} ر.ي${unitNote}`;
}

/**
 * Fetch the company VAT rate. Returns null when settings are unreadable —
 * callers must NOT invent a rate (the old silent 15% fallback booked
 * phantom VAT for Yemeni companies where no VAT applies at all).
 */
export async function getVatRate(companyId: string): Promise<number | null> {
  const res = await coreApi.getVatSettings(companyId);
  if (!res.success || !res.data) return null;
  const rate = num(res.data.vatRate);
  return rate > 0 ? rate : null;
}

export interface InvoiceTaxConfig {
  /** Effective VAT rate — 0 when the company disabled VAT on invoices OR when settings are unreadable. */
  vatRate: number;
  /** Mirrors settings `invoice.showVat` (default true). */
  showVat: boolean;
  /** Mirrors settings `invoice.showDiscount` (default true). */
  showDiscount: boolean;
  /**
   * True when the VAT rate could NOT be read from settings. The tool layer
   * then books NO VAT (never the old silent 15% fallback — the system
   * prompt explicitly forbids assuming 15%) and the engine omits the rate
   * from live context so the model must ask the user instead.
   */
  vatUnset: boolean;
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
  let settingsUnread = false;
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
    } else {
      settingsUnread = true;
    }
  } catch {
    // unreadable settings — fall back to visible (previous behavior), but
    // flag it so the VAT rate is never invented downstream.
    settingsUnread = true;
  }
  if (!showVat) return { vatRate: 0, showVat, showDiscount, vatUnset: false };
  // Unreadable show-flags OR unreadable VAT setting ⇒ unknown rate: book
  // ZERO (never a phantom 15%) and flag it so the model asks the user.
  let rate: number | null = null;
  if (!settingsUnread) {
    try {
      rate = await getVatRate(companyId);
    } catch {
      rate = null;
    }
  }
  return {
    vatRate: rate ?? 0,
    showVat,
    showDiscount,
    vatUnset: rate === null,
  };
}

export interface RawLine {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  /** Optional product_units row id — resolved to a snapshot by resolveLineUnits. */
  unitId?: string;
  /**
   * Optional unit NAME ("كرتون") the model passes in a line — exactly like
   * inventory.create_product accepts it. Resolved against the product's
   * product_units by resolveLineUnits; never silently dropped (the model
   * learned `unitName` from create_product and will keep sending it here).
   */
  unitName?: string;
}

export function parseLines(raw: unknown): RawLine[] | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'يجب تمرير صنف واحد على الأقل في lines' };
  const lines: RawLine[] = [];
  for (const item of raw) {
    const productId = str((item as Record<string, unknown>).productId);
    const quantity = num((item as Record<string, unknown>).quantity);
    const unitPrice = num((item as Record<string, unknown>).unitPrice);
    const discountPercent = num((item as Record<string, unknown>).discountPercent);
    const unitId = str((item as Record<string, unknown>).unitId);
    const unitName = str((item as Record<string, unknown>).unitName) ?? str((item as Record<string, unknown>).unit);
    if (!productId) return { error: 'كل صنف يحتاج productId — استخدم search.products لإيجاد المنتج' };
    if (quantity <= 0) return { error: 'الكمية يجب أن تكون أكبر من صفر' };
    if (unitPrice < 0) return { error: 'السعر لا يمكن أن يكون سالباً' };
    if (unitPrice <= 0) return { error: 'سعر الوحدة مطلوب لكل صنف (لا يمكن أن يكون صفراً) — احصل عليه من search.products أو search.product_units' };
    if (unitId && unitName) return { error: 'مرر unitId أو unitName فقط — لا كليهما' };
    lines.push({ productId, quantity, unitPrice, discountPercent, ...(unitId ? { unitId } : {}), ...(unitName ? { unitName } : {}) });
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
      quantity: { type: 'number', description: 'الكمية بالوحدة المختارة' },
      unitPrice: { type: 'number', description: 'سعر الوحدة المختارة (سعر البيع/الشراء من search.products أو search.product_units)' },
      discountPercent: { type: 'number', description: 'نسبة الخصم 0-100 (اختياري)' },
      unitId: { type: 'string', description: 'معرف وحدة المنتج (من search.product_units) — اختياري؛ عند تركه تُستخدم الوحدة الافتراضية للمنتج. استخدمه عندما يذكر المستخدم كرتون/درزن/شدة أو أي وحدة غير الأساسية' },
      unitName: { type: 'string', description: 'اسم الوحدة نصاً (كرتون، درزن، شدة…) — بديل لـ unitId؛ يُطابق مع وحدات المنتج ويرفض عند الغموض' },
    },
    required: ['productId', 'quantity', 'unitPrice'],
  },
};

export interface ResolvedLine extends RawLine {
  /** Frozen factor + base qty snapshot for the document line. */
  unitFactor: number;
  baseQuantity: number;
  /** Resolved display name of the chosen unit (for cards/results). */
  unitName?: string;
  /**
   * Non-empty when the resolved unit's price differs materially from the
   * model-provided unitPrice (e.g. piece price passed while a carton unit
   * was chosen) — surfaced on the confirmation card and in the result so
   * the mismatch is never silent (stock would debit N×factor while the
   * invoice charges N×base price).
   */
  priceMismatchNote?: string;
}

/**
 * Resolve each line's unit to a stock-safe snapshot. Resolution order:
 * explicit unitId → explicit unitName (matched against the product's
 * product_units, loud error on unknown/ambiguous) → the product's default
 * sale/purchase unit. When the product has NO unit rows at all, self-heal
 * once via ensureBaseProductUnit (the UI hook does this; the agent path
 * must too — legacy products otherwise silently degrade to factor=1).
 */
export async function resolveLineUnits(
  companyId: string,
  mode: 'sale' | 'purchase',
  lines: RawLine[],
): Promise<ResolvedLine[] | { error: string }> {
  const { inventoryApi } = await import('@/modules/inventory/api');
  const { defaultSaleUnit, defaultPurchaseUnit } = await import('@/core/utils/unitConversion');
  const { normalizeArabic } = await import('@/core/utils/normalizeArabic');
  type UnitRow = {
    id: string;
    factor: number;
    isBase: boolean;
    isDefaultSale: boolean;
    isDefaultPurchase: boolean;
    unitName?: string;
    unitCode?: string;
    salePrice?: number;
    purchasePrice?: number;
  };
  const cache = new Map<string, UnitRow[]>();
  const healed = new Set<string>();
  const fetchUnits = async (productId: string): Promise<UnitRow[] | { error: string }> => {
    const cached = cache.get(productId);
    if (cached) return cached;
    const res = await inventoryApi.getProductUnits(productId, companyId);
    if (!res.success || !res.data) return { error: res.error || 'فشل جلب وحدات المنتج' };
    let rows = res.data as unknown as UnitRow[];
    if (rows.length === 0 && !healed.has(productId)) {
      // Self-heal legacy products (pre-0021 or unmatched unit label): the UI
      // does this on read; without it every line silently lands on factor=1.
      healed.add(productId);
      await inventoryApi.ensureBaseProductUnit(productId, companyId);
      const retry = await inventoryApi.getProductUnits(productId, companyId);
      if (retry.success && retry.data) rows = retry.data as unknown as UnitRow[];
    }
    cache.set(productId, rows);
    return rows;
  };
  const out: ResolvedLine[] = [];
  for (const l of lines) {
    const units = await fetchUnits(l.productId);
    if ('error' in units) return { error: units.error };
    let chosen: UnitRow | undefined;
    if (l.unitId) {
      chosen = units.find((u) => u.id === l.unitId);
      if (!chosen) return { error: `وحدة غير معروفة لهذا المنتج — استخدم search.product_units أولاً لاختيار وحدة صحيحة` };
    } else if (l.unitName) {
      const norm = (s: unknown) => normalizeArabic(String(s || '')).replace(/^(ال|لل)/, '');
      const target = norm(l.unitName);
      const hits = units.filter((u) =>
        [u.unitName || '', u.unitCode || ''].some((c) => {
          const cn = norm(c);
          return !!cn && cn === target;
        }),
      );
      if (hits.length === 0) {
        return { error: `الوحدة "${l.unitName}" غير معرّفة لهذا المنتج — استخدم search.product_units لعرض وحداته أو inventory.create_product_unit لإضافتها` };
      }
      if (hits.length > 1) return { error: `الوحدة "${l.unitName}" ملتبسة (عدة تطابقات) — مرر unitId الدقيق من search.product_units` };
      chosen = hits[0];
    } else {
      chosen = (mode === 'sale' ? defaultSaleUnit(units) : defaultPurchaseUnit(units)) ?? units[0];
    }
    const factor = chosen && chosen.factor > 0 ? chosen.factor : 1;
    // Price reconciliation (U3): a piece price on a carton unit is the
    // classic silent-corruption case. Flag material mismatches so the card
    // and the result disclose them instead of booking 12× the intended stock.
    let priceMismatchNote: string | undefined;
    if (chosen) {
      const catalogPrice = mode === 'sale' ? chosen.salePrice : chosen.purchasePrice;
      const expected = Number(catalogPrice) || 0;
      if (expected > 0 && l.unitPrice > 0) {
        const ratio = l.unitPrice / expected;
        if (ratio < 0.5 || ratio > 2) {
          priceMismatchNote = `سعر الوحدة (${l.unitPrice}) يختلف كثيراً عن سعر ${chosen.unitName || 'الوحدة'} المسجّل (${expected}) — تأكد أن السعر والكمية بنفس الوحدة`;
        }
      }
    }
    out.push({
      ...l,
      unitId: chosen?.id,
      unitFactor: factor,
      baseQuantity: l.quantity * factor,
      ...(chosen?.unitName ? { unitName: chosen.unitName } : {}),
      ...(priceMismatchNote ? { priceMismatchNote } : {}),
    });
  }
  return out;
}

export interface BaseQtyResolution {
  /** Quantity converted to the product BASE unit (what stock tables store). */
  baseQuantity: number;
  /** Resolved unit display name (undefined when the quantity was already base). */
  unitName?: string;
  /** Factor applied (1 = base). */
  factor: number;
}

/**
 * M4 helper for tools whose tables carry NO unit columns (BOM lines,
 * work-order consumptions, transfer lines, stock adjustments): quantities
 * there are implicitly BASE units. Accepts an optional unitId/unitName,
 * resolves it against the product's product_units, and converts to base —
 * so "التركيبة تحتاج 2 كرتون" no longer requires the model to hand-convert
 * (2×12) with no tooling and no error. Unknown/ambiguous names fail loudly;
 * omitted units pass the quantity through as base (documented contract).
 */
export async function resolveBaseQty(
  companyId: string,
  productId: string,
  quantity: number,
  unit?: { unitId?: string; unitName?: string },
): Promise<BaseQtyResolution | { error: string }> {
  if (!unit?.unitId && !unit?.unitName) {
    return { baseQuantity: quantity, factor: 1 };
  }
  const { inventoryApi } = await import('@/modules/inventory/api');
  const { normalizeArabic } = await import('@/core/utils/normalizeArabic');
  const res = await inventoryApi.getProductUnits(productId, companyId);
  if (!res.success || !res.data) return { error: res.error || 'فشل جلب وحدات المنتج' };
  const units = res.data as unknown as Array<{
    id: string; factor: number; unitName?: string; unitCode?: string;
  }>;
  let chosen = unit.unitId ? units.find((u) => u.id === unit.unitId) : undefined;
  if (!chosen && unit.unitName) {
    const norm = (s: unknown): string => normalizeArabic(String(s || '')).replace(/^(ال|لل)/, '');
    const target = norm(unit.unitName);
    const hits = units.filter((u) =>
      [u.unitName || '', u.unitCode || ''].some((c) => {
        const cn = norm(c);
        return !!cn && cn === target;
      }),
    );
    if (hits.length === 0) {
      return { error: `الوحدة "${unit.unitName}" غير معرّفة لهذا المنتج — استخدم search.product_units لعرض وحداته` };
    }
    if (hits.length > 1) {
      return { error: `الوحدة "${unit.unitName}" ملتبسة (عدة تطابقات) — مرر unitId الدقيق من search.product_units` };
    }
    chosen = hits[0];
  }
  if (!chosen) {
    return { error: 'وحدة غير معروفة لهذا المنتج — استخدم search.product_units أولاً لاختيار وحدة صحيحة' };
  }
  const factor = chosen.factor > 0 ? chosen.factor : 1;
  return { baseQuantity: quantity * factor, unitName: chosen.unitName, factor };
}

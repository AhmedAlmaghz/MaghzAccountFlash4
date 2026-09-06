/**
 * Multi-unit conversion — single source of truth for quantity math.
 *
 * Invariants (see drizzle/0021_product_units.sql):
 * - Stock is ALWAYS stored in the product BASE unit.
 * - `factor` = how many base units equal 1 of the row unit (carton of 12 → 12).
 * - Documents snapshot `unitFactor` + `baseQuantity` at creation time, so
 *   later factor edits never rewrite history.
 * - Every helper is NaN/Infinity-safe and returns 0 instead of propagating.
 */

export interface UnitOption {
  /** product_units row id (the chosen unit snapshot key). */
  id: string;
  /** Global catalog unit id (units.id). */
  unitId: string;
  /** Resolved display name (units.name_ar → name_en → code). */
  unitName: string;
  /** Base units per 1 of this unit. Must be > 0. */
  factor: number;
  salePrice: number;
  purchasePrice: number;
  barcode?: string;
  isBase: boolean;
  isDefaultSale: boolean;
  isDefaultPurchase: boolean;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : fallback;
}

function positiveFactor(factor: unknown): number {
  const f = toFiniteNumber(factor, 0);
  return f > 0 ? f : 1;
}

/** Quantity in the chosen unit → quantity in the base unit. */
export function toBaseQty(quantity: unknown, factor: unknown): number {
  const q = toFiniteNumber(quantity, 0);
  return q * positiveFactor(factor);
}

/** Quantity in the base unit → quantity in the chosen unit. */
export function fromBaseQty(baseQuantity: unknown, factor: unknown): number {
  const q = toFiniteNumber(baseQuantity, 0);
  return q / positiveFactor(factor);
}

/** Available stock (base) expressed in the chosen unit. */
export function stockInUnit(stockBaseQty: unknown, factor: unknown): number {
  return fromBaseQty(stockBaseQty, factor);
}

/** Suggested price for a new unit row derived from the base-unit price. */
export function suggestUnitPrice(basePrice: unknown, factor: unknown): number {
  return toFiniteNumber(basePrice, 0) * positiveFactor(factor);
}

/**
 * Build the snapshot triple stored on document lines.
 * `baseQuantity` is always computed server-side style: qty × factor.
 */
export function buildLineUnitSnapshot(
  quantity: unknown,
  unit: Pick<UnitOption, 'id' | 'factor'> | null | undefined,
): { unitId?: string; unitFactor: number; baseQuantity: number } {
  const q = toFiniteNumber(quantity, 0);
  if (!unit) return { unitFactor: 1, baseQuantity: q };
  const factor = positiveFactor(unit.factor);
  return { unitId: unit.id, unitFactor: factor, baseQuantity: q * factor };
}

/** Minimal flag shape shared by UnitOption and ProductUnit. */
export interface UnitFlags {
  isBase: boolean;
  isDefaultSale: boolean;
  isDefaultPurchase: boolean;
}

/** Default sale unit = is_default_sale → base → first row. */
export function defaultSaleUnit<T extends UnitFlags>(units: T[]): T | undefined {
  if (units.length === 0) return undefined;
  return units.find((u) => u.isDefaultSale) ?? units.find((u) => u.isBase) ?? units[0];
}

/** Default purchase unit = is_default_purchase → base → first row. */
export function defaultPurchaseUnit<T extends UnitFlags>(units: T[]): T | undefined {
  if (units.length === 0) return undefined;
  return units.find((u) => u.isDefaultPurchase) ?? units.find((u) => u.isBase) ?? units[0];
}

/** Base unit row (factor semantics anchor). */
export function baseUnit<T extends UnitFlags>(units: T[]): T | undefined {
  if (units.length === 0) return undefined;
  return units.find((u) => u.isBase) ?? units[0];
}

/** Human line: "5 كرتون (≈ 60 حبة)". Empty string when nothing to show. */
export function formatQtyWithUnit(quantity: unknown, unitName: string, baseQuantity?: unknown, baseUnitName?: string): string {
  const q = toFiniteNumber(quantity, 0);
  const main = `${q} ${unitName}`.trim();
  if (baseQuantity === undefined || !baseUnitName || baseUnitName === unitName) return main;
  const b = toFiniteNumber(baseQuantity, 0);
  return `${main} (≈ ${b} ${baseUnitName})`;
}

/**
 * Normalize a document line's unit snapshot for SQL writes.
 * Server-side rule: factor defaults to 1; baseQuantity is recomputed as
 * qty × factor unless the caller already computed it (client does).
 * unitId is a pure snapshot (no FK) — null means "base/legacy".
 */
export function snapshotLineUnit(line: {
  quantity?: unknown;
  unitId?: unknown;
  unitFactor?: unknown;
  baseQuantity?: unknown;
}): { unitId: string | null; unitFactor: number; baseQuantity: number } {
  const qty = toFiniteNumber(line.quantity, 0);
  const factor = positiveFactor(line.unitFactor);
  const rawBase = line.baseQuantity;
  const base = rawBase !== undefined && rawBase !== null && rawBase !== ''
    ? toFiniteNumber(rawBase, qty * factor)
    : qty * factor;
  const unitId = typeof line.unitId === 'string' && line.unitId ? line.unitId : null;
  return { unitId, unitFactor: factor, baseQuantity: base };
}

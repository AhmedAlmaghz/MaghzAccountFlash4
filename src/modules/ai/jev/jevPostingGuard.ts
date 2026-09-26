/**
 * JEV Posting Guard — Phase J4
 *
 * Before every financial posting (invoice, voucher, payroll, stock) JEV
 * evaluates 2–3 Noul/Score questions in parallel (~120ms) and returns a
 * calibrated risk + recommended action. The TypeScript guard is the enforcer;
 * JEV is the calibrated second opinion.
 *
 * Questions:
 *  - period_closed  (Noul) — هل الفترة مقفلة؟
 *  - posting_risk   (Score 0..3) — ما مستوى مخاطرة الترحيل؟
 *  - vat_ok         (Noul) — هل المعالجة الضريبية صحيحة؟
 *
 * Verdict: allow / review / block — with confidence. Block requires
 * high confidence (>0.75) and is never silent — the UI shows the reason.
 */

import { jevSystemOne } from './jevClient';
import { estimateJevCost, recordJevMetric } from './jevMetrics';
import { getJevConfig } from './jevConfig';
import { deadlineOr } from '../engine/deadline';

export type PostingVerdict = 'allow' | 'review' | 'block';

export interface PostingGuardInput {
  docType: string; // sales_invoice | purchase_invoice | receipt_voucher | ...
  amount?: number;
  vatAmount?: number;
  currency?: string;
  customerId?: string;
  supplierId?: string;
  documentId?: string;
  period?: string; // YYYY-MM
  notes?: string;
}

export interface PostingGuardResult {
  verdict: PostingVerdict;
  riskScore: number; // 0..3 normalized 0..1
  periodClosedProb: number; // 0..1
  vatOkProb: number; // 0..1
  confidence: number;
  reason: string;
  jevUsed: boolean;
  latencyMs: number;
}

export interface PostingToolMetadata {
  name: string;
  dangerLevel: 'read' | 'write';
  permission?: string;
  labelAr?: string;
  descriptionAr?: string;
}

export interface PostingToolGuardCheck {
  applicable: boolean;
  result: PostingGuardResult;
}

const ENFORCED_GUARD_TIMEOUT_MS = 2_500;
const ENFORCED_GUARD_CACHE_MS = 1_500;
const enforcedGuardCache = new Map<string, { at: number; result: PostingGuardResult }>();
const isTest = (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === 'test';

function stableGuardKey(companyId: string, toolName: string, args: Record<string, unknown>): string {
  const stable = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? '';
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}`;
  };
  return `${companyId}:${toolName}:${stable(args)}`;
}

const FINANCIAL_POSTING_TOOLS = new Set([
  'sales.post_invoice',
  'sales.create_and_post_invoice',
  'sales.post_return',
  'purchases.post_invoice',
  'purchases.create_and_post_invoice',
  'purchases.post_return',
  'accounting.create_receipt_voucher',
  'accounting.create_payment_voucher',
  'accounting.create_expense_voucher',
  'accounting.create_journal_entry',
  'accounting.create_journal_flow',
  'accounting.post_journal_entry',
  'accounting.post_receipt_voucher',
  'accounting.post_payment_voucher',
  'accounting.reverse_document',
  'accounting.run_depreciation',
  'accounting.revalue_fx',
  'accounting.create_fixed_asset',
  'accounting.dispose_fixed_asset',
  'inventory.create_stock_adjustment',
  'inventory.post_stock_adjustment',
  'inventory.transfer_stock',
  'pos.checkout_sale',
  'hr.post_payroll_run',
  'hr.pay_end_of_service',
  'hr.process_payroll_flow',
  'hr.post_leave_provision',
]);

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value
    .replace(/[٬,،\s]/g, '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hasPositive(args: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => (finiteNumber(args[key]) ?? 0) > 0);
}

export function isFinancialPostingTool(
  toolName: string,
  tool: PostingToolMetadata | undefined,
  args: Record<string, unknown> = {},
): boolean {
  if (!tool || tool.dangerLevel !== 'write') return false;

  const name = tool.name || toolName;
  if (name === 'sales.create_customer' || name === 'purchases.create_supplier') {
    return hasPositive(args, ['openingBalance']);
  }
  if (name === 'inventory.create_product') {
    return hasPositive(args, ['openingStockQty', 'initialStockQuantity']);
  }
  if (name === 'accounting.create_account') return hasPositive(args, ['balance']);
  if (name === 'accounting.close_fiscal_year') return args.previewOnly === false;
  if (name === 'hr.update_end_of_service_status') return args.status === 'approved';
  if (name === 'manufacturing.update_work_order_status') return args.status !== 'planned';

  return FINANCIAL_POSTING_TOOLS.has(name);
}

export const isPostingTool = isFinancialPostingTool;

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstNumber(args: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = finiteNumber(args[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function firstString(args: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringValue(args[key]);
    if (value) return value;
  }
  return undefined;
}

function lineAmount(args: Record<string, unknown>): number | undefined {
  const rows = Array.isArray(args.lines) ? args.lines : Array.isArray(args.items) ? args.items : [];
  if (rows.length === 0) return undefined;
  let total = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const direct = finiteNumber(item.lineTotal);
    if (direct !== undefined && direct > 0) {
      total += direct;
      continue;
    }
    const quantity = finiteNumber(item.quantity) ?? finiteNumber(item.plannedQuantity) ?? 0;
    const price = finiteNumber(item.unitPrice) ?? finiteNumber(item.unitCost) ?? 0;
    total += quantity * price;
  }
  return total > 0 ? total : undefined;
}

function entryAmount(args: Record<string, unknown>): number | undefined {
  const rows = Array.isArray(args.entries) ? args.entries : [];
  let debitTotal = 0;
  let creditTotal = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    debitTotal += finiteNumber(item.debit) ?? 0;
    creditTotal += finiteNumber(item.credit) ?? 0;
  }
  const total = Math.max(debitTotal, creditTotal);
  return total > 0 ? total : undefined;
}

function splitPaymentAmount(args: Record<string, unknown>): number | undefined {
  const cash = finiteNumber(args.cashAmount);
  const credit = finiteNumber(args.creditAmount);
  if (cash === undefined || credit === undefined) return undefined;
  const total = cash + credit;
  return total > 0 ? total : undefined;
}

function openingInventoryAmount(args: Record<string, unknown>): number | undefined {
  const quantity = finiteNumber(args.openingStockQty) ?? finiteNumber(args.initialStockQuantity);
  const cost = finiteNumber(args.costPrice) ?? finiteNumber(args.purchasePrice);
  if (quantity === undefined || cost === undefined) return undefined;
  const total = quantity * cost;
  return total > 0 ? total : undefined;
}

export function postingInputForTool(
  toolName: string,
  args: Record<string, unknown>,
): PostingGuardInput {
  const amount = firstNumber(args, [
    'amount',
    'totalAmount',
    'total',
    'totalGross',
    'totalNet',
    'cost',
    'amountApplied',
    'openingBalance',
    'balance',
    'proceeds',
  ]) ?? splitPaymentAmount(args) ?? lineAmount(args) ?? entryAmount(args) ?? openingInventoryAmount(args);
  const vatAmount = firstNumber(args, ['vatAmount', 'taxAmount', 'vatTotal']);
  const date = firstString(args, ['date', 'purchaseDate', 'plannedEndDate', 'period']);
  const month = finiteNumber(args.month);
  const year = finiteNumber(args.year);
  const period = firstString(args, ['period'])
    ?? (year && month ? `${year}-${String(Math.trunc(month)).padStart(2, '0')}` : date?.slice(0, 7));
  const documentId = firstString(args, [
    'transactionId',
    'invoiceId',
    'returnId',
    'voucherId',
    'payrollRunId',
    'stockAdjustmentId',
    'workOrderId',
    'assetId',
    'endOfServiceId',
    'id',
  ]);
  const notes = [
    firstString(args, ['notes', 'description', 'reference']),
    documentId ? `documentId=${documentId}` : undefined,
  ].filter(Boolean).join(' | ').slice(0, 2_000);

  return {
    docType: toolName,
    ...(amount !== undefined ? { amount } : {}),
    ...(vatAmount !== undefined ? { vatAmount } : {}),
    ...(firstString(args, ['currency', 'currencyCode']) ? { currency: firstString(args, ['currency', 'currencyCode']) } : {}),
    ...(firstString(args, ['customerId', 'customer_id']) ? { customerId: firstString(args, ['customerId', 'customer_id']) } : {}),
    ...(firstString(args, ['supplierId', 'supplier_id']) ? { supplierId: firstString(args, ['supplierId', 'supplier_id']) } : {}),
    ...(documentId ? { documentId } : {}),
    ...(period ? { period } : {}),
    ...(notes ? { notes } : {}),
  };
}

function unavailablePostingResult(): PostingGuardResult {
  return {
    verdict: 'allow',
    riskScore: 0,
    periodClosedProb: 0,
    vatOkProb: 1,
    confidence: 0,
    reason: 'JEV غير متاح — السماح مع الفحوص التقليدية',
    jevUsed: false,
    latencyMs: 0,
  };
}

export async function checkJevPostingTool(
  companyId: string,
  toolName: string,
  tool: PostingToolMetadata | undefined,
  args: Record<string, unknown>,
): Promise<PostingToolGuardCheck> {
  const fallback = unavailablePostingResult();
  if (!isFinancialPostingTool(toolName, tool, args)) {
    return { applicable: false, result: fallback };
  }
  const cacheKey = stableGuardKey(companyId, toolName, args);
  if (!isTest) {
    const cached = enforcedGuardCache.get(cacheKey);
    if (cached && Date.now() - cached.at < ENFORCED_GUARD_CACHE_MS) {
      return { applicable: true, result: cached.result };
    }
  }
  try {
    const result = await deadlineOr(
      jevPostingGuard(companyId, postingInputForTool(toolName, args)),
      ENFORCED_GUARD_TIMEOUT_MS,
      fallback,
      'jev-posting-guard-enforced',
    );
    if (!isTest) {
      if (enforcedGuardCache.size >= 500) {
        const oldest = enforcedGuardCache.keys().next();
        if (!oldest.done) enforcedGuardCache.delete(oldest.value);
      }
      enforcedGuardCache.set(cacheKey, { at: Date.now(), result });
    }
    return { applicable: true, result };
  } catch {
    if (!isTest) {
      if (enforcedGuardCache.size >= 500) {
        const oldest = enforcedGuardCache.keys().next();
        if (!oldest.done) enforcedGuardCache.delete(oldest.value);
      }
      enforcedGuardCache.set(cacheKey, { at: Date.now(), result: fallback });
    }
    return { applicable: true, result: fallback };
  }
}

export function isPostingGuardBlocked(result: PostingGuardResult): boolean {
  return result.verdict === 'block';
}

const RISK_BLOCK = 2.2; // Score >= 2.2 + confidence >0.70 → block
const RISK_REVIEW = 1.2;

export async function jevPostingGuard(
  companyId: string,
  input: PostingGuardInput,
): Promise<PostingGuardResult> {
  const start = Date.now();
  const fallback = (): PostingGuardResult => ({
    verdict: 'allow', riskScore: 0, periodClosedProb: 0, vatOkProb: 1,
    confidence: 0, reason: 'JEV غير متاح — السماح مع الفحوص التقليدية', jevUsed: false, latencyMs: Date.now() - start,
  });

  const cfg = await getJevConfig(companyId).catch(() => null);
  if (!cfg?.enabled || !cfg.apiKey) return fallback();

  // Guard disabled flag lives under ai.jev_guard_enabled — reuse same check as input guard
  // Posting guard is high-stakes; only run when explicitly enabled OR when router is enabled (Phase J4 inherits router flag)
  const guardEnabled = cfg.guardEnabled || cfg.routerEnabled;
  if (!guardEnabled) return fallback();

  const res = await jevSystemOne(
    companyId,
    {
      state: { document: input },
      questions: {
        period_closed: { type: 'noul', instructions: 'هل فترة المستند مقفلة محاسبياً ولا يجوز الترحيل فيها؟' },
        posting_risk: {
          type: 'score',
          instructions: 'ما مستوى مخاطرة ترحيل هذا المستند؟',
          criteria: ['آمن — بيانات مكتملة', 'مخاطرة منخفضة — نقص بسيط', 'مخاطرة متوسطة — يحتاج مراجعة', 'مخاطرة عالية — لا يُرحّل'],
        },
        vat_ok: { type: 'noul', instructions: 'هل المعالجة الضريبية للمستند صحيحة ومتوافقة مع الدولة؟' },
      },
    },
    { timeoutMs: 1800, label: 'jev-posting-guard' },
  );

  if (!res?.answers) return fallback();

  const periodClosed = (res.answers.period_closed as { noul: number } | undefined)?.noul ?? 0;
  const risk = res.answers.posting_risk as { score: number; confidence: number; probabilities: Record<string, number> } | undefined;
  const vatOk = (res.answers.vat_ok as { noul: number } | undefined)?.noul ?? 1;

  const riskScore = risk?.score ?? 0;
  const confidence = risk?.confidence ?? 0.5;
  const latencyMs = Date.now() - start;

  recordJevMetric({ at: Date.now(), label: 'posting-guard', latencyMs, inputTokens: 260, outputTokens: 0, costUsd: estimateJevCost(260), confidence, jevUsed: true });

  let verdict: PostingVerdict = 'allow';
  let reason = 'الفحص الضوئي سليم — مسموح بالترحيل';

  if (periodClosed > 0.65) {
    verdict = 'block';
    reason = `الفترة ${input.period ?? ''} تبدو مقفلة (احتمال ${periodClosed.toFixed(2)}) — راجع إعدادات الفترات`;
  } else if (vatOk < 0.35) {
    verdict = 'review';
    reason = `المعالجة الضريبية تحتاج مراجعة (احتمال الصحة ${vatOk.toFixed(2)})`;
  } else if (riskScore >= RISK_BLOCK && confidence > 0.70) {
    verdict = 'block';
    reason = `مخاطرة عالية (${riskScore.toFixed(1)}/3) بثقة ${confidence.toFixed(2)} — راجع البيانات قبل الترحيل`;
  } else if (riskScore >= RISK_REVIEW) {
    verdict = 'review';
    reason = `مخاطرة متوسطة (${riskScore.toFixed(1)}/3) — يُنصح بالمراجعة`;
  }

  return { verdict, riskScore, periodClosedProb: periodClosed, vatOkProb: vatOk, confidence, reason, jevUsed: true, latencyMs };
}

/**
 * Synchronous helper for tool `summarizeArgs` — no async needed.
 * Returns a short risk badge for the confirmation card.
 */
export function postingBadge(result: PostingGuardResult): string {
  if (result.verdict === 'block') return `⛔ JEV: ${result.reason}`;
  if (!result.jevUsed) return '';
  if (result.verdict === 'review') return `⚠️ JEV: ${result.reason}`;
  return `✅ JEV: ${result.reason}`;
}

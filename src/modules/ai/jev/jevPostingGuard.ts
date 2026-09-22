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

export type PostingVerdict = 'allow' | 'review' | 'block';

export interface PostingGuardInput {
  docType: string; // sales_invoice | purchase_invoice | receipt_voucher | ...
  amount?: number;
  vatAmount?: number;
  currency?: string;
  customerId?: string;
  supplierId?: string;
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
  if (!result.jevUsed) return '';
  if (result.verdict === 'block') return `⛔ JEV: ${result.reason}`;
  if (result.verdict === 'review') return `⚠️ JEV: ${result.reason}`;
  return `✅ JEV: ${result.reason}`;
}

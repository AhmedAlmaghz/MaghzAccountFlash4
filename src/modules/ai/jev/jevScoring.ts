/**
 * JEV Composite Scoring — Phase J3
 *
 * Breaks complex judgments into atomic Score/Noul questions evaluated in
 * parallel by JEV, then combines with weights controlled in code.
 *
 * Each function:
 *  - Builds a state object (lead / product / ticket…)
 *  - Asks 3–5 Score questions in ONE JEV call (speculative fan-out)
 *  - Returns normalized 0..1 scores + composite + confidence
 *
 * Falls back to heuristic 0.5 when JEV is disabled / times out — never blocks.
 */

import { jevSystemOne } from './jevClient';
import { estimateJevCost, recordJevMetric } from './jevMetrics';

// ─── Generic helpers ────────────────────────────────────────────────────────

export interface ScoreDimension {
  key: string;
  score: number; // 0..max
  max: number;
  normalized: number; // 0..1
  confidence: number;
  probabilities: Record<string, number>;
}

export interface CompositeResult {
  dimensions: ScoreDimension[];
  composite: number; // 0..1 weighted
  confidence: number; // min across dimensions (conservative)
  jevUsed: boolean;
  latencyMs: number;
}

function normalize(score: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(1, score / max));
}

// ─── CRM Lead scoring (J3 core) ────────────────────────────────────────────

/** Weights for lead qualification — tweak without rewriting prompts. */
export const LEAD_WEIGHTS = {
  need: 0.30,
  budget: 0.30,
  authority: 0.25,
  timing: 0.15,
} as const;

export interface LeadInput {
  name?: string;
  message?: string;
  employees?: number;
  source?: string;
  estimatedValue?: number;
}

export async function jevScoreLead(
  companyId: string,
  lead: LeadInput,
): Promise<CompositeResult> {
  const start = Date.now();
  const fallback = (): CompositeResult => ({
    dimensions: Object.keys(LEAD_WEIGHTS).map((k) => ({
      key: k, score: 1.5, max: 3, normalized: 0.5, confidence: 0, probabilities: {},
    })),
    composite: 0.5, confidence: 0, jevUsed: false, latencyMs: Date.now() - start,
  });

  const res = await jevSystemOne(
    companyId,
    {
      state: { lead },
      questions: {
        need: {
          type: 'score',
          instructions: 'ما وضوح حاجة العميل المحتمل كما تظهر في رسالته؟',
          criteria: ['لا حاجة واضحة', 'حاجة ضعيفة أو عامة', 'حاجة واضحة ومحددة', 'حاجة ملحة ومفصلة'],
        },
        budget: {
          type: 'score',
          instructions: 'ما مستوى الجاهزية المالية كما يستدل من الرسالة وحجم الشركة؟',
          criteria: ['لا إشارة لميزانية', 'ميزانية محدودة أو غير واضحة', 'ميزانية كافية ومعلنة', 'ميزانية سخية ومؤكدة'],
        },
        authority: {
          type: 'score',
          instructions: 'هل المتحدث يملك صلاحية القرار؟',
          criteria: ['لا صلاحية', 'مؤثر لكن ليس صاحب قرار', 'صاحب قرار مباشر'],
        },
        timing: {
          type: 'score',
          instructions: 'ما قرب توقيت الشراء؟',
          criteria: ['لا توقيت مذكور', 'قريب (1-3 أشهر)', 'فوري (أقل من شهر)'],
        },
      },
    },
    { timeoutMs: 2000, label: 'jev-score-lead' },
  );

  if (!res?.answers) return fallback();

  const dims: ScoreDimension[] = [];
  const entries: Array<[string, number, number]> = [
    ['need', (res.answers.need as { score: number; confidence: number; probabilities: Record<string, number> })?.score ?? 1.5, 3],
    ['budget', (res.answers.budget as { score: number; confidence: number; probabilities: Record<string, number> })?.score ?? 1.5, 3],
    ['authority', (res.answers.authority as { score: number; confidence: number; probabilities: Record<string, number> })?.score ?? 1, 2],
    ['timing', (res.answers.timing as { score: number; confidence: number; probabilities: Record<string, number> })?.score ?? 1, 2],
  ];

  let composite = 0;
  let minConf = 1;
  for (const [key, score, max] of entries) {
    const ans = (res.answers as Record<string, { confidence: number; probabilities: Record<string, number> }>)[key];
    const conf = ans?.confidence ?? 0;
    minConf = Math.min(minConf, conf);
    const norm = normalize(score, max);
    dims.push({ key, score, max, normalized: norm, confidence: conf, probabilities: ans?.probabilities ?? {} });
    const w = LEAD_WEIGHTS[key as keyof typeof LEAD_WEIGHTS] ?? 0;
    composite += w * norm;
  }

  const latencyMs = Date.now() - start;
  recordJevMetric({ at: Date.now(), label: 'score-lead', latencyMs, inputTokens: 280, outputTokens: 0, costUsd: estimateJevCost(280), confidence: minConf, jevUsed: true });

  return { dimensions: dims, composite, confidence: minConf, jevUsed: true, latencyMs };
}

// ─── Inventory — stockout risk + reorder priority ──────────────────────────

export const STOCK_WEIGHTS = { turnover: 0.40, scarcity: 0.35, demand: 0.25 } as const;

export interface StockInput {
  productName?: string;
  quantity?: number;
  minStock?: number;
  lastMovementDays?: number;
}

export async function jevScoreStockItem(
  companyId: string,
  item: StockInput,
): Promise<CompositeResult> {
  const start = Date.now();
  const fallback = (): CompositeResult => ({
    dimensions: Object.keys(STOCK_WEIGHTS).map((k) => ({ key: k, score: 1, max: 2, normalized: 0.5, confidence: 0, probabilities: {} })),
    composite: 0.5, confidence: 0, jevUsed: false, latencyMs: Date.now() - start,
  });

  const res = await jevSystemOne(
    companyId,
    { state: { item }, questions: {
      turnover: { type: 'score', instructions: 'ما سرعة دوران هذا الصنف؟', criteria: ['راكد', 'بطيء', 'متوسط', 'سريع'] },
      scarcity: { type: 'score', instructions: 'ما حدة نقص المخزون الحالي؟', criteria: ['وفرة', 'متوسط', 'نقص حاد'] },
      demand: { type: 'score', instructions: 'ما قوة الطلب المتوقع قريباً؟', criteria: ['ضعيف', 'متوسط', 'قوي'] },
    } },
    { timeoutMs: 1800, label: 'jev-score-stock' },
  );

  if (!res?.answers) return fallback();

  const dims: ScoreDimension[] = [];
  let composite = 0;
  let minConf = 1;
  const map: Array<[string, number]> = [['turnover', 3], ['scarcity', 2], ['demand', 2]];
  for (const [key, max] of map) {
    const ans = (res.answers as Record<string, { score: number; confidence: number; probabilities: Record<string, number> }>)[key];
    const score = ans?.score ?? 1;
    const conf = ans?.confidence ?? 0;
    minConf = Math.min(minConf, conf);
    const norm = normalize(score, max);
    dims.push({ key, score, max, normalized: norm, confidence: conf, probabilities: ans?.probabilities ?? {} });
    const w = STOCK_WEIGHTS[key as keyof typeof STOCK_WEIGHTS] ?? 0;
    composite += w * norm;
  }

  const latencyMs = Date.now() - start;
  recordJevMetric({ at: Date.now(), label: 'score-stock', latencyMs, inputTokens: 220, outputTokens: 0, costUsd: estimateJevCost(220), confidence: minConf, jevUsed: true });
  return { dimensions: dims, composite, confidence: minConf, jevUsed: true, latencyMs };
}

// ─── Support ticket — urgency + frustration (generic) ──────────────────────

export async function jevScoreTicket(
  companyId: string,
  ticket: { message: string; subject?: string },
): Promise<CompositeResult> {
  const start = Date.now();
  const fallback = (): CompositeResult => ({
    dimensions: [
      { key: 'urgency', score: 0.5, max: 1, normalized: 0.5, confidence: 0, probabilities: {} },
      { key: 'frustration', score: 1, max: 2, normalized: 0.5, confidence: 0, probabilities: {} },
    ],
    composite: 0.5, confidence: 0, jevUsed: false, latencyMs: Date.now() - start,
  });

  const res = await jevSystemOne(
    companyId,
    { state: { ticket }, questions: {
      urgency: { type: 'noul', instructions: 'هل تعبّر الرسالة عن إلحاح زمني؟' },
      frustration: { type: 'score', instructions: 'ما مستوى انزعاج العميل؟', criteria: ['هادئ', 'منزعج لكن مهذب', 'غاضب جداً'] },
    } },
    { timeoutMs: 1500, label: 'jev-score-ticket' },
  );
  if (!res?.answers) return fallback();

  const urg = (res.answers.urgency as { noul: number } | undefined)?.noul ?? 0.5;
  const fru = res.answers.frustration as { score: number; confidence: number; probabilities: Record<string, number> } | undefined;
  const fruNorm = fru ? normalize(fru.score, 2) : 0.5;
  const composite = 0.5 * urg + 0.5 * fruNorm;
  const conf = fru?.confidence ?? 0.5;
  const latencyMs = Date.now() - start;
  recordJevMetric({ at: Date.now(), label: 'score-ticket', latencyMs, inputTokens: 200, outputTokens: 0, costUsd: estimateJevCost(200), confidence: conf, jevUsed: true });
  return {
    dimensions: [
      { key: 'urgency', score: urg, max: 1, normalized: urg, confidence: urg > 0.7 || urg < 0.3 ? 0.8 : 0.5, probabilities: {} },
      { key: 'frustration', score: fru?.score ?? 1, max: 2, normalized: fruNorm, confidence: conf, probabilities: fru?.probabilities ?? {} },
    ],
    composite, confidence: conf, jevUsed: true, latencyMs,
  };
}

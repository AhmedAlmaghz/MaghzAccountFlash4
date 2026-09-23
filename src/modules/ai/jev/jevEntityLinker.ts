/**
 * JEV Entity Linker — faster alternative to fuzzy DB entityResolver.
 *
 * Instead of 19 tables × 16 tokens fan-out (~500ms PGlite), ask JEV:
 *   Choice: which existing customer does "شركة الأمل" refer to? { قائمة الأسماء + لا أحد }
 *
 * One JEV call with 1 Choice per token, each with shortlist 10 candidates.
 * Calibrated confidence decides auto-replace vs ask.
 *
 * Consumed by the jevSearchAll rank stage (jevSearch.ts step 4): merged hits
 * are re-ordered through this Choice, so the linker is live — not standalone.
 * It is also importable directly for single-token linking flows.
 */

import { jevSystemOne } from './jevClient';
import { estimateJevCost, recordJevMetric } from './jevMetrics';

export interface LinkCandidate {
  id: string;
  name: string;
}

export interface LinkResult {
  token: string;
  choice: string; // candidate name or '__none__'
  confidence: number;
  probabilities: Record<string, number>;
}

export async function jevLinkEntities(
  companyId: string,
  tokens: string[],
  candidates: LinkCandidate[],
  label = 'entity-link',
): Promise<LinkResult[]> {
  if (tokens.length === 0 || candidates.length === 0) return [];

  const candidateMap: Record<string, string> = {};
  for (const c of candidates) candidateMap[c.name] = `العميل/المورد: ${c.name}`;
  candidateMap['__none__'] = 'لا يطابق أياً مما سبق — اسم جديد';

  const questions: Record<string, { type: 'choice'; instructions: string; criteria: Record<string, string> }> = {};
  for (let i = 0; i < tokens.length; i++) {
    questions[`link_${i}`] = {
      type: 'choice',
      instructions: `أي كيان يقصده "${tokens[i]}"؟`,
      criteria: candidateMap,
    };
  }

  const start = Date.now();
  const res = await jevSystemOne(
    companyId,
    { state: { tokens, candidateCount: candidates.length }, questions },
    { timeoutMs: 2000, label },
  );

  if (!res?.answers) {
    return tokens.map((t) => ({ token: t, choice: '__none__', confidence: 0, probabilities: {} }));
  }

  const out: LinkResult[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const ans = (res.answers as Record<string, { choice: string; confidence: number; probabilities: Record<string, number> }>)[`link_${i}`];
    out.push({
      token: tokens[i],
      choice: ans?.choice ?? '__none__',
      confidence: ans?.confidence ?? 0,
      probabilities: ans?.probabilities ?? {},
    });
  }

  recordJevMetric({ at: Date.now(), label, latencyMs: Date.now() - start, inputTokens: tokens.length * 40, outputTokens: 0, costUsd: estimateJevCost(tokens.length * 40), confidence: out[0]?.confidence ?? 0, jevUsed: true });

  return out;
}

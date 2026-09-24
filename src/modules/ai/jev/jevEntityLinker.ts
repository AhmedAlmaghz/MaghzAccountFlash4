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
  return jevLinkGroups(
    companyId,
    tokens.map((token) => ({ token, candidates })),
    label,
  );
}

/**
 * Batch linking — one JEV call, one Choice per group, each group with its OWN
 * candidate list. This is the form jevSearchAll uses: one group per routed
 * entity family (supplier candidates never compete with warehouse candidates,
 * which is what produced wrong-family winners before).
 */
export interface LinkGroup {
  token: string;
  candidates: LinkCandidate[];
}

export async function jevLinkGroups(
  companyId: string,
  groups: LinkGroup[],
  label = 'entity-link',
): Promise<LinkResult[]> {
  if (groups.length === 0) return [];
  const live = groups.filter((g) => g.candidates.length > 0);
  if (live.length === 0) {
    return groups.map((g) => ({ token: g.token, choice: '__none__', confidence: 0, probabilities: {} }));
  }

  const questions: Record<string, { type: 'choice'; instructions: string; criteria: Record<string, string> }> = {};
  live.forEach((g, i) => {
    const candidateMap: Record<string, string> = {};
    for (const c of g.candidates) candidateMap[c.name] = c.name;
    candidateMap['__none__'] = 'لا يطابق أياً مما سبق — اسم جديد';
    questions[`link_${i}`] = {
      type: 'choice',
      instructions: `أي كيان يقصده "${g.token}"؟ أجب باسم المرشح حرفياً كما هو مكتوب.`,
      criteria: candidateMap,
    };
  });

  const start = Date.now();
  const res = await jevSystemOne(
    companyId,
    { state: { groups: live.map((g) => g.token) }, questions },
    { timeoutMs: 2000, label },
  );

  if (!res?.answers) {
    return groups.map((g) => ({ token: g.token, choice: '__none__', confidence: 0, probabilities: {} }));
  }

  // Map live answers back onto the full groups array (empty groups → __none__).
  let li = 0;
  const out: LinkResult[] = groups.map((g) => {
    if (g.candidates.length === 0) {
      return { token: g.token, choice: '__none__', confidence: 0, probabilities: {} };
    }
    const ans = (res.answers as Record<string, { choice: string; confidence: number; probabilities: Record<string, number> }>)[`link_${li++}`];
    return {
      token: g.token,
      choice: ans?.choice ?? '__none__',
      confidence: ans?.confidence ?? 0,
      probabilities: ans?.probabilities ?? {},
    };
  });

  const best = Math.max(0, ...out.map((o) => o.confidence));
  recordJevMetric({ at: Date.now(), label, latencyMs: Date.now() - start, inputTokens: live.length * 40, outputTokens: 0, costUsd: estimateJevCost(live.length * 40), confidence: best, jevUsed: true });

  return out;
}

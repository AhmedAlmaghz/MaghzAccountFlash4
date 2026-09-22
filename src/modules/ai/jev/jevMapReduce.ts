/**
 * JEV Map-Reduce — Phase J5
 *
 * Process big data (thousands of rows) with JEV at 100× lower cost than LLM.
 * Pattern: map each chunk with speculative fan-out Nouls in parallel, then
 * reduce in code (filter / rank / aggregate).
 *
 * Example: score 5k invoices for churn risk, then train a downstream model.
 * Cost: 5k × 250 tokens × $0.042/MTok = $0.052 vs $5+ with LLM.
 */

import { jevSystemOne } from './jevClient';
import { estimateJevCost, recordJevMetric } from './jevMetrics';

export interface MapReduceOptions<T> {
  items: T[];
  chunkSize?: number; // default 20 — 20 questions per JEV call via state array
  concurrency?: number; // default 4 — parallel JEV calls
  label?: string;
}

export interface MapReduceResult<T, R> {
  results: Array<{ item: T; value: R; index: number }>;
  totalItems: number;
  jevCalls: number;
  totalLatencyMs: number;
  totalCostUsd: number;
  jevUsed: boolean;
}

/**
 * Generic Noul scorer — asks one yes/no question per item, returns probabilities.
 * Each chunk is one JEV call with N Nouls (one per item) — speculative fan-out.
 */
export async function jevMapNoul<T>(
  companyId: string,
  opts: MapReduceOptions<T> & { question: string; extractState: (item: T) => unknown },
): Promise<MapReduceResult<T, number>> {
  const { items, question, extractState, chunkSize = 20, concurrency = 4, label = 'map-noul' } = opts;
  const start = Date.now();
  if (items.length === 0) return { results: [], totalItems: 0, jevCalls: 0, totalLatencyMs: 0, totalCostUsd: 0, jevUsed: false };

  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) chunks.push(items.slice(i, i + chunkSize));

  const chunkResults: Array<Array<{ item: T; value: number; index: number }>> = new Array(chunks.length);
  let jevCalls = 0;
  let totalCostUsd = 0;

  // Process chunks with limited concurrency
  for (let c = 0; c < chunks.length; c += concurrency) {
    const batch = chunks.slice(c, c + concurrency);
    const batchStartIdx = c * chunkSize;
    const promises = batch.map(async (chunk, bIdx) => {
      const chunkIdx = c + bIdx;
      const base = chunkIdx * chunkSize;
      // Build N Noul questions — one per item
      const questions: Record<string, { type: 'noul'; instructions: string }> = {};
      chunk.forEach((item, i) => {
        const id = `q_${i}`;
        // Use extractState to build per-item context, but JEV state is shared —
        // we embed per-item data in the question instructions via structure
        questions[id] = {
          type: 'noul',
          instructions: {
            item: extractState(item) as never,
            question,
          } as unknown as string,
        };
      });

      // State is the chunk summary — JEV reads questions' structured instructions
      const res = await jevSystemOne(companyId, { state: { chunk: chunk.length }, questions }, { timeoutMs: 4000, label });
      const chunkOut: Array<{ item: T; value: number; index: number }> = [];
      if (res?.answers) {
        chunk.forEach((item, i) => {
          const ans = (res.answers as Record<string, { noul: number }>)[`q_${i}`];
          chunkOut.push({ item, value: ans?.noul ?? 0.5, index: base + i });
        });
        jevCalls++;
        totalCostUsd += estimateJevCost(200 + chunk.length * 30);
      } else {
        // Fallback — neutral 0.5
        chunk.forEach((item, i) => chunkOut.push({ item, value: 0.5, index: base + i }));
      }
      return { chunkIdx, chunkOut };
    });

    const settled = await Promise.all(promises);
    for (const { chunkIdx, chunkOut } of settled) {
      chunkResults[chunkIdx] = chunkOut;
      void batchStartIdx;
    }
  }

  const results = chunkResults.flat().filter(Boolean);
  const totalLatencyMs = Date.now() - start;
  recordJevMetric({ at: Date.now(), label, latencyMs: totalLatencyMs, inputTokens: items.length * 30, outputTokens: 0, costUsd: totalCostUsd, jevUsed: jevCalls > 0 });

  return { results, totalItems: items.length, jevCalls, totalLatencyMs, totalCostUsd, jevUsed: jevCalls > 0 };
}

/**
 * Rank items by a Score question — returns sorted results.
 */
export async function jevRankByScore<T>(
  companyId: string,
  opts: MapReduceOptions<T> & { question: string; criteria: string[]; extractState: (item: T) => unknown },
): Promise<MapReduceResult<T, { score: number; confidence: number }>> {
  const { items, question, criteria, extractState, chunkSize = 15, concurrency = 4, label = 'rank-score' } = opts;
  const start = Date.now();
  if (items.length === 0) return { results: [], totalItems: 0, jevCalls: 0, totalLatencyMs: 0, totalCostUsd: 0, jevUsed: false };

  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) chunks.push(items.slice(i, i + chunkSize));

  const chunkResults: Array<Array<{ item: T; value: { score: number; confidence: number }; index: number }>> = new Array(chunks.length);
  let jevCalls = 0;
  let totalCostUsd = 0;

  for (let c = 0; c < chunks.length; c += concurrency) {
    const batch = chunks.slice(c, c + concurrency);
    const promises = batch.map(async (chunk, bIdx) => {
      const chunkIdx = c + bIdx;
      const base = chunkIdx * chunkSize;
      const questions: Record<string, unknown> = {};
      chunk.forEach((_, i) => {
        (questions as Record<string, unknown>)[`q_${i}`] = { type: 'score', instructions: { item: extractState(chunk[i]) as never, question } as unknown as string, criteria };
      });
      const res = await jevSystemOne(companyId, { state: { chunk: chunk.length }, questions: questions as never }, { timeoutMs: 4000, label });
      const chunkOut: Array<{ item: T; value: { score: number; confidence: number }; index: number }> = [];
      if (res?.answers) {
        chunk.forEach((item, i) => {
          const ans = (res.answers as Record<string, { score: number; confidence: number }>)[`q_${i}`];
          chunkOut.push({ item, value: { score: ans?.score ?? 1, confidence: ans?.confidence ?? 0 }, index: base + i });
        });
        jevCalls++;
        totalCostUsd += estimateJevCost(250 + chunk.length * 40);
      } else {
        chunk.forEach((item, i) => chunkOut.push({ item, value: { score: 1, confidence: 0 }, index: base + i }));
      }
      return { chunkIdx, chunkOut };
    });
    const settled = await Promise.all(promises);
    for (const { chunkIdx, chunkOut } of settled) chunkResults[chunkIdx] = chunkOut;
  }

  const results = chunkResults.flat().filter(Boolean);
  const totalLatencyMs = Date.now() - start;
  recordJevMetric({ at: Date.now(), label, latencyMs: totalLatencyMs, inputTokens: items.length * 40, outputTokens: 0, costUsd: totalCostUsd, jevUsed: jevCalls > 0 });

  return { results, totalItems: items.length, jevCalls, totalLatencyMs, totalCostUsd, jevUsed: jevCalls > 0 };
}

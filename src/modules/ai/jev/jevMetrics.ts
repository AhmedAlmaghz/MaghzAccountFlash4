/**
 * JEV metrics — lightweight in-memory telemetry for latency / cost / confidence.
 * No persistence; surfaced in jevDiagnostics for the settings page.
 */

export interface JevCallMetric {
  at: number;
  label: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number; // $0.042 / MTok input, output free
  confidence?: number;
  intent?: string;
  jevUsed: boolean;
}

const MAX_METRICS = 200;
const metrics: JevCallMetric[] = [];

const COST_PER_MTOK = 0.042;
const COST_PER_TOKEN = COST_PER_MTOK / 1_000_000;

export function recordJevMetric(m: JevCallMetric): void {
  metrics.push(m);
  if (metrics.length > MAX_METRICS) metrics.shift();
}

export function getJevMetrics(): JevCallMetric[] {
  return [...metrics];
}

export function getJevMetricsSummary(): {
  totalCalls: number;
  jevCalls: number;
  fallbackCalls: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  totalCostUsd: number;
  totalTokens: number;
  avgConfidence: number | null;
} {
  const totalCalls = metrics.length;
  const jevCalls = metrics.filter((m) => m.jevUsed).length;
  const fallbackCalls = totalCalls - jevCalls;
  const jevLatencies = metrics.filter((m) => m.jevUsed).map((m) => m.latencyMs).sort((a, b) => a - b);
  const avgLatencyMs = jevLatencies.length ? jevLatencies.reduce((a, b) => a + b, 0) / jevLatencies.length : null;
  const p95LatencyMs = jevLatencies.length ? jevLatencies[Math.floor(jevLatencies.length * 0.95)] ?? jevLatencies[jevLatencies.length - 1] : null;
  const totalCostUsd = metrics.reduce((a, m) => a + m.costUsd, 0);
  const totalTokens = metrics.reduce((a, m) => a + m.inputTokens + m.outputTokens, 0);
  const confidences = metrics.filter((m) => m.confidence != null).map((m) => m.confidence as number);
  const avgConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;
  return { totalCalls, jevCalls, fallbackCalls, avgLatencyMs, p95LatencyMs, totalCostUsd, totalTokens, avgConfidence };
}

export function estimateJevCost(inputTokens: number): number {
  return inputTokens * COST_PER_TOKEN;
}

export function clearJevMetrics(): void {
  metrics.length = 0;
}

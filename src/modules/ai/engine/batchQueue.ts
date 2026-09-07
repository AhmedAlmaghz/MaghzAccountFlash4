/**
 * AI job-queue core — pure logic, no DB / IO / React.
 *
 * A batch groups many tool calls under ONE user approval. Items may link to
 * an EARLIER item of the same batch (`after`) so composite flows
 * (supplier -> its invoices -> their vouchers) execute in dependency order.
 * The engine resolves semantic refs to seq numbers and proves the graph is
 * a DAG before anything is written — the `after_seq` column itself carries
 * no FK by design.
 *
 * Golden rules applied here:
 * - Stable args key: object keys are sorted recursively before hashing, so
 *   the same call with different key order is the same idempotency key
 *   (Phase 75 stable-key lesson).
 * - A dependency may only point BACKWARD (after_seq < seq). Forward refs
 *   are rejected — this makes cycles structurally impossible, with an
 *   explicit DFS as defense-in-depth.
 */

export type BatchStatus = 'pending' | 'running' | 'paused' | 'done' | 'partial' | 'cancelled';

export type BatchItemStatus = 'queued' | 'running' | 'done' | 'failed' | 'skipped';

export interface BatchItemInput {
  tool: string;
  args: Record<string, unknown>;
  /**
   * Dependency on an earlier item: a seq number, or a semantic `ref` of an
   * earlier item (e.g. after: "new-supplier"). Forward references are
   * rejected — dependencies always point backward.
   */
  after?: number | string;
  /** Stable name later items can reference via `after`. */
  ref?: string;
  /** Human display note (direction badge) — carried through, never executed. */
  label?: string;
}

export interface ResolvedBatchItem {
  seq: number;
  tool: string;
  args: Record<string, unknown>;
  afterSeq: number | null;
  idempotencyKey: string;
  label: string | null;
}

export type ResolveResult =
  | { ok: true; items: ResolvedBatchItem[] }
  | { ok: false; error: string };

const TERMINAL_BATCH: ReadonlySet<string> = new Set(['done', 'partial', 'cancelled']);

export function isTerminalBatchStatus(status: string): boolean {
  return TERMINAL_BATCH.has(status);
}

/** Recursive key-sorted stringify — key order never affects the output. */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  const json = JSON.stringify(value);
  return json === undefined ? 'null' : json;
}

/** FNV-1a 32-bit hex — tiny, dependency-free, renderer-safe (no crypto). */
export function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Idempotency key for one item: tool + stable args hash. Re-enqueueing the
 * same file / resending the same batch can never duplicate items —
 * UNIQUE(batch_id, idempotency_key) enforces it in the DB too.
 */
export function buildIdempotencyKey(tool: string, args: Record<string, unknown>): string {
  return `${tool}:${fnv1aHex(stableStringify(args))}`;
}

/**
 * Assign seq numbers, resolve `after` refs and prove the graph is a DAG.
 * Pure — registry existence checks belong to the tool layer, not here.
 */
export function resolveBatchItems(inputs: BatchItemInput[]): ResolveResult {
  if (inputs.length === 0) return { ok: false, error: 'الدفعة فارغة — لا توجد عناصر للتنفيذ' };

  const refToSeq = new Map<string, number>();
  inputs.forEach((item, i) => {
    if (item.ref) {
      if (refToSeq.has(item.ref)) {
        return;
      }
      refToSeq.set(item.ref, i);
    }
  });
  const dupRef = inputs.map((i) => i.ref).filter(Boolean) as string[];
  if (new Set(dupRef).size !== dupRef.length) {
    return { ok: false, error: 'مرجع مكرر في عناصر الدفعة — كل ref يجب أن يكون فريداً' };
  }

  const afterSeq: Array<number | null> = new Array(inputs.length).fill(null);
  for (let i = 0; i < inputs.length; i++) {
    const after = inputs[i].after;
    if (after === undefined || after === null) continue;
    let target: number | null = null;
    if (typeof after === 'number') {
      target = after;
    } else if (typeof after === 'string') {
      const found = refToSeq.get(after);
      if (found === undefined) {
        return { ok: false, error: `العنصر ${i}: المرجع "${after}" غير موجود في الدفعة` };
      }
      target = found;
    } else {
      return { ok: false, error: `العنصر ${i}: مرجع الاعتماد after يجب أن يكون رقماً أو اسماً` };
    }
    if (!Number.isInteger(target) || target < 0 || target >= inputs.length) {
      return { ok: false, error: `العنصر ${i}: الاعتماد على ${String(after)} خارج نطاق الدفعة` };
    }
    if (target >= i) {
      return { ok: false, error: `العنصر ${i}: الاعتماد يجب أن يكون على عنصر سابق فقط (تسلسل أمامي مرفوض)` };
    }
    afterSeq[i] = target;
  }

  // Defense-in-depth DFS cycle check (unreachable with backward-only edges,
  // but the graph shape must never be trusted implicitly).
  const visitState = new Array<number>(inputs.length).fill(0);
  const visit = (n: number): boolean => {
    if (visitState[n] === 1) return false;
    if (visitState[n] === 2) return true;
    visitState[n] = 1;
    const dep = afterSeq[n];
    if (dep !== null && !visit(dep)) return false;
    visitState[n] = 2;
    return true;
  };
  for (let i = 0; i < inputs.length; i++) {
    if (!visit(i)) return { ok: false, error: 'اعتماد دائري بين عناصر الدفعة — مرفوض' };
  }

  return {
    ok: true,
    items: inputs.map((item, i) => ({
      seq: i,
      tool: item.tool,
      args: item.args,
      afterSeq: afterSeq[i],
      idempotencyKey: buildIdempotencyKey(item.tool, item.args),
      label: typeof item.label === 'string' ? item.label.slice(0, 200) : null,
    })),
  };
}

/**
 * Retry backoff for a failed item. `failures` counts failures so far
 * (1 = just failed once). Returns the delay before the next attempt, or
 * null when the item must be marked failed permanently.
 * Schedule: immediate -> 30s -> 5min -> give up (3 retries max).
 */
export function nextRetryDelayMs(failures: number): number | null {
  if (failures <= 1) return 0;
  if (failures === 2) return 30_000;
  if (failures === 3) return 300_000;
  return null;
}

/** Maximum execution attempts per item (1 initial + 3 retries). */
export const MAX_ITEM_ATTEMPTS = 4;

/** Arabic one-line progress summary for batch cards and messages. */
export function summarizeBatchProgress(done: number, failed: number, skipped: number, total: number): string {
  const remaining = Math.max(0, total - done - failed - skipped);
  return `أُنجز ${done} — فشل ${failed} — تُخطّي ${skipped} — متبقٍ ${remaining} (من ${total})`;
}

import { aiApi } from './index';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useAiStore } from '../store';
import { resolveBatchItems, type BatchItemInput } from '../engine/batchQueue';
import { getTool } from '../tools/registry';
import { canExecute } from '../engine/toolExecutor';
import type { JobBatchDetail, JobBatchItemInput, JobBatchSummary } from './batchTypes';
import { BATCH_CREATE_CHUNK } from './batchTypes';

/**
 * Renderer client for the AI job queue.
 *
 * Batches group many tool calls under ONE user approval. Items are
 * DAG-validated client-side (fail fast, Arabic errors) before anything is
 * written; per-item RBAC is enforced twice — once here at enqueue (honest
 * upfront error) and again by executeToolCall inside the worker.
 */

export interface EnqueueBatchOptions {
  title?: string;
  kind?: string;
  items: BatchItemInput[];
}

function currentContext(): { companyId: string; userId: string } | null {
  const companyId = useAppStore.getState().activeCompany?.id;
  const userId = useAuthStore.getState().user?.id;
  if (!companyId || !userId) return null;
  return { companyId, userId };
}

export interface BatchContextOverride {
  companyId?: string;
  userId?: string;
}

function resolveContext(override?: BatchContextOverride): { companyId: string; userId: string } | null {
  if (override?.companyId && override?.userId) {
    return { companyId: override.companyId, userId: override.userId };
  }
  return currentContext();
}

export async function enqueueBatch(
  opts: EnqueueBatchOptions & BatchContextOverride,
): Promise<{
  success: boolean;
  data?: { batchId: string; total: number };
  error?: string;
}> {
  const ctx = resolveContext(opts);
  if (!ctx) return { success: false, error: 'لا توجد شركة نشطة أو مستخدم مسجل' };
  if (opts.items.length === 0) return { success: false, error: 'الدفعة فارغة — لا توجد عناصر للتنفيذ' };
  if (opts.items.length > BATCH_CREATE_CHUNK) {
    return {
      success: false,
      error: `الدفعة تحوي ${opts.items.length} عنصراً — الحد ${BATCH_CREATE_CHUNK} لكل دفعة. قسّمها لدفعات متتالية`,
    };
  }

  // Every item must name a registered tool the user is allowed to run.
  // Fail fast here instead of discovering it 40 items into the run.
  for (let i = 0; i < opts.items.length; i++) {
    const tool = getTool(opts.items[i].tool);
    if (!tool) return { success: false, error: `العنصر ${i}: أداة غير معروفة ${opts.items[i].tool}` };
    if (tool.dangerLevel !== 'write') {
      return { success: false, error: `العنصر ${i}: ${opts.items[i].tool} أداة قراءة — الدفعات للعمليات الكتابية فقط` };
    }
    if (!canExecute(tool)) {
      return { success: false, error: `العنصر ${i}: ليس لديك صلاحية ${tool.permission} للأداة ${tool.name}` };
    }
    if (!opts.items[i].args || typeof opts.items[i].args !== 'object') {
      return { success: false, error: `العنصر ${i}: الوسائط args يجب أن تكون كائناً` };
    }
  }

  const resolved = resolveBatchItems(opts.items);
  if (!resolved.ok) return { success: false, error: resolved.error };

  const payloadItems: JobBatchItemInput[] = resolved.items.map((it) => ({
    tool_name: it.tool,
    args: it.args,
    after_seq: it.afterSeq,
    idempotency_key: it.idempotencyKey,
    label: it.label,
  }));

  const sessionId = useAiStore.getState().sessionId;
  const res = await aiApi.batchCreate({
    companyId: ctx.companyId,
    userId: ctx.userId,
    title: opts.title?.slice(0, 200) ?? null,
    kind: opts.kind?.slice(0, 40) ?? 'mixed',
    sessionId,
    items: payloadItems,
  });
  if (!res.success || !res.data) return { success: false, error: res.error || 'فشل إنشاء الدفعة' };
  return { success: true, data: { batchId: res.data.batchId, total: res.data.total } };
}

export async function getBatch(batchId: string, override?: BatchContextOverride): Promise<{
  success: boolean;
  data?: JobBatchDetail;
  error?: string;
}> {
  const ctx = resolveContext(override);
  if (!ctx) return { success: false, error: 'لا توجد شركة نشطة أو مستخدم مسجل' };
  const res = await aiApi.batchGet(ctx.companyId, ctx.userId, batchId);
  if (!res.success || !res.data) return { success: false, error: res.error || 'الدفعة غير موجودة' };
  return { success: true, data: res.data };
}

export async function listBatches(status?: string, override?: BatchContextOverride): Promise<{
  success: boolean;
  data?: JobBatchSummary[];
  error?: string;
}> {
  const ctx = resolveContext(override);
  if (!ctx) return { success: false, error: 'لا توجد شركة نشطة أو مستخدم مسجل' };
  const res = await aiApi.batchList(ctx.companyId, ctx.userId, status);
  if (!res.success || !res.data) return { success: false, error: res.error || 'فشل جلب الدفعات' };
  return { success: true, data: res.data };
}

/** Batches that can be resumed after a restart (running or paused). */
export async function findResumableBatches(): Promise<JobBatchSummary[]> {
  const running = await listBatches('running');
  const paused = await listBatches('paused');
  const seen = new Map<string, JobBatchSummary>();
  for (const list of [running.data ?? [], paused.data ?? []]) {
    for (const b of list) {
      if (!seen.has(b.id)) seen.set(b.id, b);
    }
  }
  return [...seen.values()];
}

export function getBatchContext() {
  return currentContext();
}

async function setStatus(
  batchId: string,
  status: 'paused' | 'running' | 'cancelled',
  override?: BatchContextOverride,
): Promise<{ success: boolean; error?: string }> {
  const ctx = resolveContext(override);
  if (!ctx) return { success: false, error: 'لا توجد شركة نشطة أو مستخدم مسجل' };
  const res = await aiApi.batchSetStatus(ctx.companyId, ctx.userId, batchId, status);
  if (!res.success) return { success: false, error: res.error || 'فشل تحديث حالة الدفعة' };
  return { success: true };
}

/** Pause a running batch — the worker stops claiming; resume any time. */
export function pauseBatch(batchId: string, override?: BatchContextOverride) {
  return setStatus(batchId, 'paused', override);
}

/** Resume a paused batch. */
export function unpauseBatch(batchId: string, override?: BatchContextOverride) {
  return setStatus(batchId, 'running', override);
}

/** Cancel a batch — queued/running items park as skipped. */
export function cancelBatch(batchId: string, override?: BatchContextOverride) {
  return setStatus(batchId, 'cancelled', override);
}

/** Requeue failed items of a partial batch (attempts reset). */
export async function retryFailedBatch(
  batchId: string,
  override?: BatchContextOverride,
): Promise<{ success: boolean; data?: { requeued: number }; error?: string }> {
  const ctx = resolveContext(override);
  if (!ctx) return { success: false, error: 'لا توجد شركة نشطة أو مستخدم مسجل' };
  const res = await aiApi.batchRetryFailed(ctx.companyId, ctx.userId, batchId);
  if (!res.success || !res.data) return { success: false, error: res.error || 'فشل إعادة العناصر الفاشلة' };
  return { success: true, data: res.data };
}

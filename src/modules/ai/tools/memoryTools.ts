import type { ToolDefinition } from '../types';
import { coreApi } from '@/modules/core/api';

/**
 * Long-term memory (C2) — user-pinned facts that survive across sessions.
 *
 * Deliberately backed by the generic company settings store
 * (`coreApi.getSettings/setSetting`, category `ai_memory`) instead of a new
 * table: zero migrations, zero IPC channels, both environments work today,
 * company scoping + audit come free from the existing typed-RPC path.
 *
 * - Keys are `ai.memory.<id>`; values are JSON `{text, createdAt}`.
 * - Forgetting ERASES the content (tombstone value `''` — no PII remains;
 *   the empty key shell is an implementation detail, never shown).
 * - The engine auto-injects the freshest facts into every system prompt
 *   (see loadMemoryBlock) so "تذكر أن…" works next week, not just today.
 * - Cap: 100 live facts/company — the tool refuses with guidance to forget.
 */

export const MEMORY_CATEGORY = 'ai_memory';
const MEMORY_KEY_PREFIX = 'ai.memory.';
const MAX_FACTS = 100;
const MAX_FACT_CHARS = 500;
/** Auto-inject budget: freshest facts, hard-capped for the prompt. */
const INJECT_MAX_FACTS = 8;
const INJECT_MAX_CHARS = 1200;

export interface MemoryFact {
  id: string;
  text: string;
  createdAt: string;
}

function factIdFromKey(key: string): string {
  return key.startsWith(MEMORY_KEY_PREFIX) ? key.slice(MEMORY_KEY_PREFIX.length) : key;
}

function parseFact(key: string, value: string | null | undefined): MemoryFact | null {
  if (!value || !value.trim()) return null; // tombstone (forgotten) — content gone
  try {
    const obj = JSON.parse(value) as { text?: unknown; createdAt?: unknown };
    const text = typeof obj.text === 'string' ? obj.text.trim() : '';
    if (!text) return null;
    return {
      id: factIdFromKey(key),
      text: text.slice(0, MAX_FACT_CHARS),
      createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : '',
    };
  } catch {
    return null;
  }
}

/** All live (non-forgotten) facts for a company, oldest first. */
export async function loadMemoryFacts(companyId: string): Promise<MemoryFact[]> {
  if (!companyId) return [];
  try {
    const res = await coreApi.getSettings(companyId, MEMORY_CATEGORY);
    if (!res.success || !res.data) return [];
    const out: MemoryFact[] = [];
    for (const row of res.data) {
      if (!row.key.startsWith(MEMORY_KEY_PREFIX)) continue;
      const fact = parseFact(row.key, row.value);
      if (fact) out.push(fact);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Render the auto-injected prompt block (null = nothing pinned).
 * Best-effort by design: unreadable store ⇒ no block, never an error.
 */
export async function loadMemoryBlock(companyId: string): Promise<string | null> {
  const facts = await loadMemoryFacts(companyId);
  if (facts.length === 0) return null;
  const lines: string[] = [];
  let used = 0;
  for (const f of facts.slice(-INJECT_MAX_FACTS)) {
    const line = `- ${f.text}`;
    if (used + line.length > INJECT_MAX_CHARS) break;
    lines.push(line);
    used += line.length;
  }
  if (lines.length === 0) return null;
  return `حقائق مثبتة عن الشركة (حفظها المستخدم بأداة التذكر — اعتمدها ولا تطلبها مجدداً):\n${lines.join('\n')}`;
}

function newFactId(): string {
  try {
    const c = globalThis.crypto as Crypto | undefined;
    if (c && typeof c.randomUUID === 'function') return `mem_${c.randomUUID().slice(0, 8)}`;
  } catch { /* fall through */ }
  return `mem_${Date.now().toString(36)}${Math.floor(Math.random() * 0xffff).toString(36)}`;
}

export const memoryTools: ToolDefinition[] = [
  {
    name: 'ai.remember_fact',
    labelAr: 'تذكر حقيقة',
    descriptionAr:
      'احفظ حقيقة مثبتة عن الشركة (اسم المالك، العملة المعتمدة، سياسة خصم دائمة…) — تبقى عبر الجلسات وتُحقن تلقائياً في كل محادثة. استخدمها فقط عندما يقول المستخدم "تذكر/احفظ" صراحة.',
    permission: 'ai.use',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'نص الحقيقة (2-500 حرفاً)' },
      },
      required: ['text'],
    },
    summarizeArgs: (a) => `حفظ حقيقة: ${String((a as Record<string, unknown>).text || '').slice(0, 80)}`,
    execute: async (args, ctx) => {
      const text = typeof args.text === 'string' ? args.text.trim() : '';
      if (text.length < 2) return { error: 'نص الحقيقة قصير جداً — اذكر حقيقة كاملة (كلمتين على الأقل)' };
      if (text.length > MAX_FACT_CHARS) {
        return { error: `الحقيقة أطول من ${MAX_FACT_CHARS} حرفاً — اختصرها ثم احفظ` };
      }
      const existing = await loadMemoryFacts(ctx.companyId);
      if (existing.some((f) => f.text === text)) {
        return { error: 'هذه الحقيقة محفوظة مسبقاً — لا تكرار' };
      }
      if (existing.length >= MAX_FACTS) {
        return {
          error: `وصلت الحقائق المحفوظة إلى الحد (${MAX_FACTS}) — احذف القديم بـ ai.forget_fact أولاً`,
        };
      }
      const id = newFactId();
      const res = await coreApi.setSetting({
        companyId: ctx.companyId,
        key: `${MEMORY_KEY_PREFIX}${id}`,
        value: JSON.stringify({ text, createdAt: new Date().toISOString() }),
        category: MEMORY_CATEGORY,
      });
      if (!res.success) return { error: res.error || 'فشل حفظ الحقيقة' };
      return { factId: id, text, saved: true };
    },
  },
  {
    name: 'ai.recall_facts',
    labelAr: 'استعراض الحقائق',
    descriptionAr:
      'اعرض الحقائق المثبتة المحفوظة عن الشركة (مع معرف كل حقيقة) — استخدمها عندما يسأل المستخدم "ماذا تتذكر؟" أو قبل حذف حقيقة.',
    permission: 'ai.use',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'ترشيح اختياري بنص جزئي' },
      },
    },
    execute: async (args, ctx) => {
      const facts = await loadMemoryFacts(ctx.companyId);
      const q = typeof args.query === 'string' ? args.query.trim() : '';
      const list = q ? facts.filter((f) => f.text.includes(q)) : facts;
      return { facts: list.slice(0, 50), totalFacts: facts.length };
    },
  },
  {
    name: 'ai.forget_fact',
    labelAr: 'نسيان حقيقة',
    descriptionAr:
      'احذف حقيقة مثبتة نهائياً (يُمحى محتواها فوراً) — بالمعرف من ai.recall_facts أو بنص جزئي مطابق. عند تطابق عدة حقائق لا تحذف شيئاً واعرض المرشحين أولاً.',
    permission: 'ai.use',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'معرف الحقيقة (من ai.recall_facts)' },
        text: { type: 'string', description: 'أو نص جزئي للمطابقة' },
      },
    },
    summarizeArgs: (a) => {
      const r = a as Record<string, unknown>;
      return `نسيان حقيقة: ${String(r.id || r.text || '').slice(0, 80)}`;
    },
    execute: async (args, ctx) => {
      const id = typeof args.id === 'string' ? args.id.trim() : '';
      const text = typeof args.text === 'string' ? args.text.trim() : '';
      if (!id && !text) return { error: 'مرر id الحقيقة أو نصاً جزئياً — استخدم ai.recall_facts لعرضها أولاً' };
      const facts = await loadMemoryFacts(ctx.companyId);
      if (id) {
        const hit = facts.find((f) => f.id === id);
        if (!hit) return { error: 'لا توجد حقيقة بهذا المعرف — استخدم ai.recall_facts لعرض المعرفات' };
        // Tombstone = content erased immediately (no PII remains in the row).
        const res = await coreApi.setSetting({
          companyId: ctx.companyId,
          key: `${MEMORY_KEY_PREFIX}${id}`,
          value: '',
          category: MEMORY_CATEGORY,
        });
        if (!res.success) return { error: res.error || 'فشل الحذف' };
        return { forgotten: true, id, text: hit.text };
      }
      const hits = facts.filter((f) => f.text.includes(text));
      if (hits.length === 0) return { error: 'لا توجد حقيقة مطابقة لهذا النص' };
      if (hits.length > 1) {
        return {
          error: 'تطابقت عدة حقائق — لم يُحذف شيء',
          candidates: hits.map((h) => ({ id: h.id, text: h.text })),
        };
      }
      const res = await coreApi.setSetting({
        companyId: ctx.companyId,
        key: `${MEMORY_KEY_PREFIX}${hits[0].id}`,
        value: '',
        category: MEMORY_CATEGORY,
      });
      if (!res.success) return { error: res.error || 'فشل الحذف' };
      return { forgotten: true, id: hits[0].id, text: hits[0].text };
    },
  },
];

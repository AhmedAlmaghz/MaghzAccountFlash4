/**
 * ai.resolve_entities — the ONLY model-facing entity-resolution tool.
 *
 * Replaces the old fan-out pattern (one LLM turn + one 200-row fetch PER
 * search.* family). The engine calls entityService directly in send(); this
 * tool exists so the model can resolve a missed/ambiguous entity mid-chain
 * with the same deterministic contract (same/confirm/missing) instead of
 * guessing across search.* tools.
 */
import type { ToolDefinition } from '../types';
import { resolveEntities, type EntityKind } from '../engine/entityService';

const KINDS: EntityKind[] = [
  'customer',
  'supplier',
  'product',
  'account',
  'cash_box',
  'warehouse',
  'employee',
  'lead',
  'opportunity',
  'invoice',
  'purchaseInvoice',
  'quotation',
  'receiptVoucher',
  'paymentVoucher',
  'workOrder',
  'bom',
];

export const entityTools: ToolDefinition[] = [
  {
    name: 'ai.resolve_entities',
    labelAr: 'حل الكيانات',
    descriptionAr:
      'يحل أسماء الكيانات (عميل/مورد/منتج/حساب/خزنة/مستودع/موظف/...) إلى معرفاتها مرة واحدة بقرار حتمي واحد. استخدمه بدل أي أداة search.* مفردة عند الحاجة لحل كيان منتصف السلسلة. يعيد لكل كيان: same (نفذ بهذا المعرف) أو confirm (اسأل المستخدم مرة واحدة) أو missing (أخبر المستخدم واسأله أتريد إنشاءه — لا تكرر البحث) أو skip (نص أطول من 400 حرف: قائمة مهام لا اسم كيان — استخدم أدوات search.* لكل بند على حدة).',
    permission: 'ai.use',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        entities: {
          type: 'array',
          description: 'الكيانات المطلوب حلها (نصها كما ورد + نوعها)',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'النص المراد حله' },
              kind: { type: 'string', description: `النوع: ${KINDS.join('/')}` },
            },
            required: ['text', 'kind'],
          },
        },
      },
      required: ['entities'],
    },
    execute: async (args, ctx) => {
      const raw = args.entities;
      if (!Array.isArray(raw) || raw.length === 0) {
        return { error: 'entities مطلوبة (مصفوفة غير فارغة)' };
      }
      const requests = raw
        .slice(0, 12)
        .filter(
          (e): e is { text: unknown; kind: unknown } =>
            !!e && typeof e === 'object' && 'text' in (e as object) && 'kind' in (e as object),
        )
        .map((e) => ({
          text: String((e as { text: unknown }).text ?? '').trim(),
          kind: String((e as { kind: unknown }).kind ?? '').trim() as EntityKind,
        }))
        .filter((e) => e.text.length > 0 && (KINDS as string[]).includes(e.kind));
      if (requests.length === 0) {
        return { error: 'لا كيانات صالحة (text غير فارغ + kind من القائمة المدعومة)' };
      }
      const resolved = await resolveEntities(requests, ctx.companyId, { rbacFilter: true });
      return {
        resolved: resolved.map((r) => ({
          text: r.request.text,
          kind: r.request.kind,
          status: r.status,
          id: r.id,
          name: r.name,
          score: r.score,
          candidates: r.candidates,
        })),
      };
    },
  },
];

/**
 * JEV Tools — Phase J3/J5
 *
 * LLM-callable tools that delegate scoring / ranking to JEV with calibrated
 * confidence. Each tool is a thin wrapper over jevScoring / jevMapReduce —
 * the heavy lifting is in those pure helpers.
 *
 * These tools are READ-only (no confirmation needed) and respect RBAC
 * via the same permission as their domain.
 */

import type { ToolDefinition } from '../types';
import { jevScoreLead, jevScoreStockItem } from './jevScoring';

export const jevTools: ToolDefinition[] = [
  {
    name: 'jev.score_lead',
    descriptionAr: 'قيّم عميلاً محتملاً بأربع درجات متوازية (حاجة/ميزانية/صلاحية/توقيت) عبر JEV — يعيد درجات معايرة ومركباً بأوزان الكود',
    labelAr: 'تقييم عميل محتمل (JEV)',
    permission: 'crm.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'اسم العميل المحتمل' },
        message: { type: 'string', description: 'رسالة العميل أو ملاحظات' },
        employees: { type: 'number', description: 'عدد الموظفين (اختياري)' },
        estimatedValue: { type: 'number', description: 'القيمة المتوقعة (اختياري)' },
      },
      required: ['message'],
    },
    summarizeArgs: (a) => `تقييم: ${String(a.name ?? a.message).slice(0, 40)}`,
    execute: async (args, ctx) => {
      const res = await jevScoreLead(ctx.companyId, {
        name: args.name as string | undefined,
        message: args.message as string,
        employees: args.employees as number | undefined,
        estimatedValue: args.estimatedValue as number | undefined,
      });
      return {
        composite: res.composite,
        confidence: res.confidence,
        jevUsed: res.jevUsed,
        latencyMs: res.latencyMs,
        dimensions: res.dimensions.map((d) => ({ key: d.key, normalized: d.normalized, confidence: d.confidence, score: d.score })),
        verdict: res.composite > 0.65 ? 'مؤهل' : res.composite > 0.40 ? 'يحتاج متابعة' : 'غير مؤهل',
      };
    },
  },
  {
    name: 'jev.score_stock',
    descriptionAr: 'قيّم صنفاً مخزنياً (دوران/ندرة/طلب) عبر JEV — يحدد أولوية إعادة الطلب',
    labelAr: 'تقييم صنف مخزني (JEV)',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        productName: { type: 'string', description: 'اسم الصنف' },
        quantity: { type: 'number', description: 'الكمية الحالية' },
        minStock: { type: 'number', description: 'الحد الأدنى' },
        lastMovementDays: { type: 'number', description: 'أيام منذ آخر حركة' },
      },
      required: ['productName'],
    },
    summarizeArgs: (a) => `مخزون: ${String(a.productName).slice(0, 30)}`,
    execute: async (args, ctx) => {
      const res = await jevScoreStockItem(ctx.companyId, {
        productName: args.productName as string,
        quantity: args.quantity as number | undefined,
        minStock: args.minStock as number | undefined,
        lastMovementDays: args.lastMovementDays as number | undefined,
      });
      return {
        composite: res.composite,
        confidence: res.confidence,
        jevUsed: res.jevUsed,
        priority: res.composite > 0.70 ? 'عاجل' : res.composite > 0.45 ? 'متوسط' : 'منخفض',
        dimensions: res.dimensions,
      };
    },
  },
  {
    name: 'jev.rank_customers_churn',
    descriptionAr: 'رتّب العملاء حسب خطر التسرب عبر JEV — Map-Reduce على دفعات 20 عميلاً في كل طلب',
    labelAr: 'ترتيب خطر التسرب (JEV)',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        customerIds: { type: 'array', items: { type: 'string' }, description: 'معرفات العملاء (اختياري — إن تُرك فارغاً يُستخدم كل العملاء)' },
        limit: { type: 'number', description: 'عدد النتائج الأعلى (افتراضي 10)' },
      },
    },
    summarizeArgs: (a) => `ترتيب تسرب: ${Array.isArray(a.customerIds) ? (a.customerIds as string[]).length : 'الكل'} عميل`,
    execute: async (args, ctx) => {
      const { getDbAdapter } = await import('@/core/database/adapters');
      const adapter = await getDbAdapter();
      let ids = args.customerIds as string[] | undefined;
      if (!ids || ids.length === 0) {
        const res = await adapter.query<{ id: string }>(`SELECT id FROM customers WHERE company_id = $1 LIMIT 100`, [ctx.companyId]);
        ids = (res.rows ?? []).map((r) => r.id);
      }
      const limit = Math.min(Math.max(Number(args.limit ?? 10), 1), 50);
      // For now, rank via simple heuristic + JEV Noul per customer (fan-out)
      const { jevMapNoul } = await import('./jevMapReduce');
      const items = ids.slice(0, 50).map((id) => ({ id }));
      const result = await jevMapNoul(ctx.companyId, {
        items,
        question: 'هل هذا العميل معرّض لخطر التسرب قريباً؟',
        extractState: (it) => ({ customerId: (it as { id: string }).id }),
        label: 'rank-churn',
      });
      const ranked = result.results.sort((a, b) => b.value - a.value).slice(0, limit);
      return {
        ranked: ranked.map((r) => ({ customerId: (r.item as { id: string }).id, churnProb: r.value })),
        jevUsed: result.jevUsed,
        jevCalls: result.jevCalls,
        costUsd: result.totalCostUsd,
      };
    },
  },
];

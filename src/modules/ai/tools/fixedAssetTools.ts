import type { ToolDefinition } from '../types';
import { fixedAssetsApi } from '@/modules/accounting/assets';
import { num, str } from './writeTools/shared';
import { localToday } from '../engine/dateUtils';
import { normalizeArabic, fuzzyMatchScore } from '@/core/utils/normalizeArabic';
import { normalizeDateArg } from '../engine/argNormalizers';

/**
 * Fixed-asset tools — سجل الأصول الثابتة (3 أدوات).
 *
 * Reads stay behind accounting.view. Creation posts its capitalization JE
 * atomically inside the API (Dr 12101 / Cr treasury|payables|opening), and
 * disposal posts the gain/loss JE — both are write-gated with
 * confirmation-card summaries.
 */

const METHODS = ['straight_line', 'declining_balance'] as const;

export const fixedAssetTools: ToolDefinition[] = [
  {
    name: 'search.fixed_assets',
    labelAr: 'بحث عن أصل ثابت',
    descriptionAr: 'يبحث في الأصول الثابتة بالاسم أو الرمز ويعيد معرفها (id) وقيمتها الدفترية وحالتها. استخدمه قبل الاستبعاد أو الإهلاك.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'اسم الأصل أو رمزه (فارغ = تصفح الأحدث)' },
      },
    },
    execute: async (args, ctx) => {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      const res = await fixedAssetsApi.getFixedAssets(ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل جلب الأصول الثابتة' };
      const list = res.data ?? [];
      const toRow = (a: (typeof list)[number]) => ({
        id: a.id,
        code: a.code,
        name: a.nameAr,
        category: a.category,
        cost: a.cost,
        netBookValue: a.netBookValue,
        status: a.status,
      });
      if (!query) {
        const head = list.slice(0, 8).map(toRow);
        return {
          matches: head,
          totalMatches: head.length,
          suggestion: 'عرض أول الأصول لأن البحث كان فارغاً — مرّر اسماً أدق في query للتضييق',
        };
      }
      const nq = normalizeArabic(query);
      const scored = list
        .map((a) => ({
          a,
          s: fuzzyMatchScore(nq, `${a.nameAr ?? ''} ${a.code ?? ''}`),
        }))
        .filter((x) => x.s >= 0.35)
        .sort((x, y) => y.s - x.s)
        .slice(0, 8);
      return {
        matches: scored.map((x) => toRow(x.a)),
        totalMatches: scored.length,
      };
    },
  },
  {
    name: 'accounting.list_fixed_assets',
    labelAr: 'قائمة الأصول الثابتة',
    descriptionAr: 'يسرد الأصول الثابتة للشركة مع التكلفة والمجمع والقيمة الدفترية والحالة.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async (_args, ctx) => {
      const res = await fixedAssetsApi.getFixedAssets(ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل جلب الأصول الثابتة' };
      return {
        assets: (res.data ?? []).map((a) => ({
          id: a.id,
          code: a.code,
          nameAr: a.nameAr,
          category: a.category,
          cost: a.cost,
          accumulatedDepreciation: a.accumulatedDepreciation,
          netBookValue: a.netBookValue,
          status: a.status,
        })),
        total: (res.data ?? []).length,
      };
    },
  },

  {
    name: 'accounting.create_fixed_asset',
    labelAr: 'تسجيل أصل ثابت',
    descriptionAr: 'يسجل أصلاً ثابتاً جديداً مع قيد الرسملة تلقائياً (مدين الأصول الثابتة / دائن الخزينة أو الدائنين أو الافتتاحي حسب التمويل). التمويل النقدي يتطلب cashBoxId (من search.cash_boxes). الطريقة والتمويل تقبلان العربية (ثابت/متناقص، نقدي/آجل/افتتاحي).',
    permission: 'accounting.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'رمز الأصل (اختياري — يُولَّد تلقائياً)' },
        name: { type: 'string', description: 'اسم الأصل (إلزامي)' },
        nameAr: { type: 'string', description: 'بديل لـ name' },
        nameEn: { type: 'string', description: 'اسم الأصل بالإنجليزية' },
        category: { type: 'string', description: 'فئة الأصل (معدات، سيارات، أثاث…)' },
        purchaseDate: { type: 'string', description: 'تاريخ الشراء (اختياري — يقبل "12-8" و"15 أغسطس"، افتراضي اليوم)' },
        cost: { type: 'number', description: 'تكلفة الشراء (أكبر من صفر)' },
        salvageValue: { type: 'number', description: 'القيمة التخريدية (افتراضي 0)' },
        usefulLifeMonths: { type: 'number', description: 'العمر الإنتاجي بالشهور 1-1200' },
        method: { type: 'string', description: 'طريقة الإهلاك: straight_line/ثابت أو declining_balance/متناقص (افتراضي straight_line)' },
        funding: { type: 'string', description: 'مصدر التمويل: cash/نقدي، payable/آجل، opening/افتتاحي (افتراضي cash)' },
        cashBoxId: { type: 'string', description: 'معرف الخزينة — إلزامي للتمويل النقدي' },
      },
      required: ['cost', 'usefulLifeMonths'],
    },
    summarizeArgs: (a) => {
      const r = a as Record<string, unknown>;
      return `تسجيل أصل ثابت "${String(r.name ?? r.nameAr ?? '')}" بتكلفة ${r.cost} (تمويل ${r.funding || 'cash'})`;
    },
    execute: async (args, ctx) => {
      const rec = args as Record<string, unknown>;
      const nameAr = str(rec.name) ?? str(rec.nameAr);
      const cost = num(args.cost);
      if (!nameAr) return { error: 'اسم الأصل مطلوب (name أو nameAr)' };
      if (!(cost > 0)) return { error: 'تكلفة الأصل يجب أن تكون أكبر من صفر' };
      const life = num(args.usefulLifeMonths);
      if (!Number.isInteger(life) || life < 1 || life > 1200) {
        return { error: 'العمر الإنتاجي يجب أن يكون عدداً صحيحاً بين 1 و 1200 شهراً' };
      }
      const methodRaw = str(args.method) || 'straight_line';
      const methodNorm = normalizeArabic(methodRaw);
      const method = /متناقص|declining/.test(methodNorm) ? 'declining_balance'
        : /ثابت|قسط|straight|line/.test(methodNorm) ? 'straight_line'
        : (METHODS as readonly string[]).includes(methodRaw) ? methodRaw : null;
      if (!method) {
        return { error: 'طريقة الإهلاك يجب أن تكون straight_line/ثابت أو declining_balance/متناقص' };
      }
      const purchaseRaw = str(args.purchaseDate);
      const purchaseDate = purchaseRaw ? (normalizeDateArg(purchaseRaw) ?? null) : localToday();
      if (!purchaseDate || !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
        return { error: `تاريخ الشراء غير مفهوم ("${purchaseRaw}") — استخدم YYYY-MM-DD أو "15 أغسطس 2026"` };
      }
      const salvageValue = num(args.salvageValue);
      if (salvageValue < 0) return { error: 'القيمة التخريدية لا يمكن أن تكون سالبة' };
      if (salvageValue >= cost) return { error: 'القيمة التخريدية يجب أن تكون أقل من التكلفة' };
      const fundingRaw = str(args.funding) || 'cash';
      const fundingNorm = normalizeArabic(fundingRaw);
      const fundingKind = /دائن|آجل|payable/.test(fundingNorm) ? 'payable'
        : /افتتاح|opening/.test(fundingNorm) ? 'opening'
        : /نقد|كاش|cash/.test(fundingNorm) ? 'cash' : null;
      if (!fundingKind) {
        return { error: 'مصدر التمويل يجب أن يكون cash/نقدي أو payable/آجل أو opening/افتتاحي' };
      }
      const cashBoxId = str(args.cashBoxId);
      if (fundingKind === 'cash' && !cashBoxId) {
        return { error: 'التمويل النقدي يتطلب cashBoxId — استخدم search.cash_boxes أولاً' };
      }
      const res = await fixedAssetsApi.createFixedAsset(
        {
          companyId: ctx.companyId,
          ...(str(args.code) ? { code: str(args.code) as string } : {}),
          nameAr,
          ...(str(args.nameEn) ? { nameEn: str(args.nameEn) as string } : {}),
          ...(str(args.category) ? { category: str(args.category) as string } : {}),
          purchaseDate,
          cost,
          salvageValue,
          usefulLifeMonths: life,
          method: method as (typeof METHODS)[number],
          funding: { kind: fundingKind, ...(cashBoxId ? { cashBoxId } : {}) },
        },
        ctx.userId
      );
      if (!res.success) return { error: res.error || 'فشل تسجيل الأصل' };
      return { created: true, assetId: res.id, code: res.code, cost };
    },
  },

  {
    name: 'accounting.dispose_fixed_asset',
    labelAr: 'استبعاد أصل ثابت',
    descriptionAr: 'يستبعد أصلاً ثابتاً نشطاً مع قيد الاستبعاد (تصفية المجمع + متحصلات + ربح/خسارة) ويقلب حالته إلى مستبعَد نهائياً. يتطلب سبباً واضحاً.',
    permission: 'accounting.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: 'معرف الأصل (من accounting.list_fixed_assets)' },
        date: { type: 'string', description: 'تاريخ الاستبعاد YYYY-MM-DD (افتراضي اليوم)' },
        proceeds: { type: 'number', description: 'المتحصلات النقدية (افتراضي 0 — بلا بيع)' },
        cashBoxId: { type: 'string', description: 'معرف الخزينة — إلزامي عند وجود متحصلات' },
        reason: { type: 'string', description: 'سبب الاستبعاد (3 أحرف على الأقل — إلزامي)' },
      },
      required: ['assetId', 'reason'],
    },
    summarizeArgs: (a) => {
      const r = a as Record<string, unknown>;
      const proceeds = num(r.proceeds);
      return `استبعاد أصل ${String(r.assetId || '').slice(0, 8)}${proceeds > 0 ? ` بمتحصلات ${proceeds}` : ' بلا متحصلات'} — السبب: ${String(r.reason || '')}`;
    },
    execute: async (args, ctx) => {
      const assetId = str(args.assetId);
      if (!assetId) return { error: 'assetId مطلوب — استخدم accounting.list_fixed_assets أولاً' };
      const reason = str(args.reason) || '';
      if (reason.trim().length < 3) return { error: 'سبب الاستبعاد مطلوب (3 أحرف على الأقل)' };
      const proceeds = num(args.proceeds);
      if (proceeds < 0) return { error: 'المتحصلات لا يمكن أن تكون سالبة' };
      const cashBoxId = str(args.cashBoxId);
      if (proceeds > 0 && !cashBoxId) {
        return { error: 'الاستبعاد بمتحصلات يتطلب cashBoxId — استخدم search.cash_boxes أولاً' };
      }
      const date = str(args.date) || localToday();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'تاريخ الاستبعاد يجب أن يكون YYYY-MM-DD' };
      const res = await fixedAssetsApi.disposeFixedAsset(
        ctx.companyId,
        assetId,
        {
          date,
          proceeds,
          ...(cashBoxId ? { cashBoxId } : {}),
          reason: reason.trim(),
        },
        ctx.userId
      );
      if (!res.success) return { error: res.error || 'فشل استبعاد الأصل' };
      return { disposed: true, assetId, reference: res.data?.reference, gain: res.data?.gain, loss: res.data?.loss };
    },
  },
];

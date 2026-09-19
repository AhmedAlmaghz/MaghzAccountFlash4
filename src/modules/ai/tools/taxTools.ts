import type { ToolDefinition } from '../types';
import {
  getCompanyTaxContext,
  setCompanyTaxContext,
  openTaxPeriod,
  setTaxPeriodStatus,
  listTaxPeriods,
  computeVatReturn,
} from '@/modules/tax/engine';
import { accountingApi } from '@/modules/accounting/api';
import { hrApi } from '@/modules/hr/api';
import { str } from './writeTools/shared';

/**
 * Tax / periods / FX / leave-provision tools (8 أدوات).
 *
 * Reads stay behind settings.view (jurisdiction) or accounting.view
 * (periods, VAT return). Writes use settings.edit for the jurisdiction,
 * accounting.create/post for period lifecycle + FX revaluation, and hr.edit
 * for the leave provision (the hr module defines no .post grant — same as
 * hr.post_payroll_run which is gated by hr.edit).
 */

const COUNTRIES = ['SA', 'AE', 'EG', 'YE'] as const;

function validDate(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day);
}

export const taxTools: ToolDefinition[] = [
  {
    name: 'settings.get_tax_country',
    labelAr: 'الدولة الضريبية',
    descriptionAr: 'يعيد الولاية الضريبية للشركة: كود الدولة ومعدل الضريبة والمنطقة الزمنية — تُستخدم قبل أي حساب ضريبي.',
    permission: 'settings.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async (_args, ctx) => {
      const taxCtx = await getCompanyTaxContext(ctx.companyId);
      return {
        countryCode: taxCtx.countryCode,
        timezone: taxCtx.timezone,
        vatRate: taxCtx.profile.vat.standard,
        currency: taxCtx.profile.registration.currency,
      };
    },
  },

  {
    name: 'settings.set_tax_country',
    labelAr: 'تعيين الدولة الضريبية',
    descriptionAr: 'يضبط الدولة الضريبية للشركة (SA السعودية 15%، AE الإمارات 5%، EG مصر 14%، YE اليمن صفرية) مع المنطقة الزمنية — يحدد معدلات الضريبة والقواعد المطبقة.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        countryCode: { type: 'string', enum: ['SA', 'AE', 'EG', 'YE'], description: 'كود الدولة (SA/AE/EG/YE)' },
        timezone: { type: 'string', description: 'المنطقة الزمنية (اختياري — افتراضي منطقة الدولة)' },
      },
      required: ['countryCode'],
    },
    summarizeArgs: (a) => `تعيين الدولة الضريبية إلى ${String((a as Record<string, unknown>).countryCode || '')}`,
    execute: async (args, ctx) => {
      const countryCode = (str(args.countryCode) || '').toUpperCase();
      if (!(COUNTRIES as readonly string[]).includes(countryCode)) {
        return { error: 'كود الدولة يجب أن يكون SA أو AE أو EG أو YE' };
      }
      const res = await setCompanyTaxContext(ctx.companyId, countryCode, str(args.timezone) || '');
      if (!res.success) return { error: res.error || 'فشل تعيين الدولة الضريبية' };
      return { updated: true, countryCode };
    },
  },

  {
    name: 'tax.list_periods',
    labelAr: 'قائمة الفترات الضريبية',
    descriptionAr: 'يسرد الفترات الضريبية للشركة (الأحدث أولاً) مع الحالة: open مفتوحة، closed مغلقة، filed مقدَّمة.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async (_args, ctx) => {
      const periods = await listTaxPeriods(ctx.companyId);
      return {
        periods: periods.map((p) => ({
          id: p.id,
          countryCode: p.countryCode,
          periodType: p.periodType,
          startDate: p.startDate,
          endDate: p.endDate,
          status: p.status,
        })),
        total: periods.length,
      };
    },
  },

  {
    name: 'tax.open_period',
    labelAr: 'فتح فترة ضريبية',
    descriptionAr: 'يفتح فترة ضريبية جديدة (لا يقبل الترحيل داخل فترة مغلقة/مقدَّمة — استخدمها لتجهيز فترة الإقرار القادمة).',
    permission: 'accounting.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'بداية الفترة YYYY-MM-DD' },
        endDate: { type: 'string', description: 'نهاية الفترة YYYY-MM-DD' },
        countryCode: { type: 'string', description: 'كود الدولة (اختياري — افتراضي دولة الشركة)' },
        periodType: { type: 'string', description: 'نوع الفترة (افتراضي monthly)' },
      },
      required: ['startDate', 'endDate'],
    },
    summarizeArgs: (a) => {
      const r = a as Record<string, unknown>;
      return `فتح فترة ضريبية ${String(r.startDate || '')} – ${String(r.endDate || '')}`;
    },
    execute: async (args, ctx) => {
      const startDate = str(args.startDate) || '';
      const endDate = str(args.endDate) || '';
      if (!validDate(startDate) || !validDate(endDate)) {
        return { error: 'تاريخا البداية والنهاية يجب أن يكونا YYYY-MM-DD' };
      }
      if (endDate < startDate) return { error: 'نهاية الفترة يجب أن تكون بعد بدايتها' };
      const taxCtx = await getCompanyTaxContext(ctx.companyId);
      const countryCode = ((str(args.countryCode) || '').toUpperCase() || taxCtx.countryCode);
      if (!(COUNTRIES as readonly string[]).includes(countryCode)) {
        return { error: 'كود الدولة يجب أن يكون SA أو AE أو EG أو YE' };
      }
      const periodType = str(args.periodType) || 'monthly';
      const res = await openTaxPeriod(ctx.companyId, { countryCode, periodType, startDate, endDate });
      if (!res.success) return { error: res.error || 'فشل فتح الفترة' };
      return { opened: true, periodId: res.id, startDate, endDate };
    },
  },

  {
    name: 'tax.close_period',
    labelAr: 'إغلاق فترة ضريبية',
    descriptionAr: 'يغلق فترة ضريبية مفتوحة — بعد الإغلاق يُرفض أي ترحيل بتاريخ داخلها. أغلق فقط بعد مراجعة الإقرار.',
    permission: 'accounting.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        periodId: { type: 'string', description: 'معرف الفترة (من tax.list_periods)' },
      },
      required: ['periodId'],
    },
    summarizeArgs: (a) => `إغلاق فترة ضريبية ${String((a as Record<string, unknown>).periodId || '').slice(0, 8)}`,
    execute: async (args, ctx) => {
      const periodId = str(args.periodId);
      if (!periodId) return { error: 'periodId مطلوب — استخدم tax.list_periods أولاً' };
      const res = await setTaxPeriodStatus(ctx.companyId, periodId, 'closed');
      if (!res.success) return { error: res.error || 'فشل إغلاق الفترة' };
      return { closed: true, periodId };
    },
  },

  {
    name: 'tax.file_period',
    labelAr: 'تقديم فترة ضريبية',
    descriptionAr: 'يعلّم فترة ضريبية مغلقة كمقدَّمة للهيئة (filed) — خطوة نهائية بعد التقديم الفعلي. اعرض الإقرار عبر tax.vat_return أولاً.',
    permission: 'accounting.post',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        periodId: { type: 'string', description: 'معرف الفترة (من tax.list_periods)' },
      },
      required: ['periodId'],
    },
    summarizeArgs: (a) => `تقديم فترة ضريبية ${String((a as Record<string, unknown>).periodId || '').slice(0, 8)}`,
    execute: async (args, ctx) => {
      const periodId = str(args.periodId);
      if (!periodId) return { error: 'periodId مطلوب — استخدم tax.list_periods أولاً' };
      const res = await setTaxPeriodStatus(ctx.companyId, periodId, 'filed');
      if (!res.success) return { error: res.error || 'فشل تقديم الفترة' };
      return { filed: true, periodId };
    },
  },

  {
    name: 'tax.vat_return',
    labelAr: 'إقرار ضريبة القيمة المضافة',
    descriptionAr: 'يحسب إقرار VAT لفترة ضريبية من أرجل القيود المرحّلة (المصدر الوحيد للحقيقة): ضريبة المخرجات − ضريبة المدخلات = الصافي المستحق/القابل للاسترداد.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        periodId: { type: 'string', description: 'معرف الفترة (من tax.list_periods)' },
      },
      required: ['periodId'],
    },
    execute: async (args, ctx) => {
      const periodId = str(args.periodId);
      if (!periodId) return { error: 'periodId مطلوب — استخدم tax.list_periods أولاً' };
      const periods = await listTaxPeriods(ctx.companyId);
      const period = periods.find((p) => p.id === periodId);
      if (!period) return { error: 'الفترة غير موجودة' };
      const res = await computeVatReturn(ctx.companyId, period);
      if (!res.success) return { error: res.error || 'فشل حساب الإقرار' };
      return {
        periodId,
        startDate: period.startDate,
        endDate: period.endDate,
        outputVat: res.data?.outputVat,
        inputVat: res.data?.inputVat,
        netPayable: res.data?.netPayable,
        payable: res.data?.payable,
        currencyCode: res.data?.currencyCode,
      };
    },
  },

  {
    name: 'accounting.revalue_fx',
    labelAr: 'إعادة تقييم العملات',
    descriptionAr: 'يعيد تقييم أرصدة الفواتير الأجنبية المفتوحة بسعر الصرف الحالي ويرحّل قيد فروق الصرف (مرجع FX-YYYYMMDD) — متجاوز ما قُيِّم سابقاً تلقائياً.',
    permission: 'accounting.post',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'تاريخ التقييم YYYY-MM-DD (افتراضي اليوم)' },
      },
    },
    summarizeArgs: (a) => {
      const r = a as Record<string, unknown>;
      return `إعادة تقييم أرصدة العملات الأجنبية${r.date ? ` بتاريخ ${String(r.date)}` : ''}`;
    },
    execute: async (args, ctx) => {
      const date = str(args.date);
      if (date && !validDate(date)) return { error: 'التاريخ يجب أن يكون YYYY-MM-DD' };
      const res = await accountingApi.revalueForeignBalances(ctx.companyId, ctx.userId, date || undefined);
      if (!res.success) return { error: res.error || 'فشل إعادة التقييم' };
      return {
        revalued: true,
        reference: res.data?.reference,
        lines: res.data?.lines,
        gain: res.data?.gain,
        loss: res.data?.loss,
        currencies: res.data?.currencies,
      };
    },
  },

  {
    name: 'hr.post_leave_provision',
    labelAr: 'ترحيل مخصص الإجازات',
    descriptionAr: 'يرحّل مخصص الإجازات السنوية غير المستخدمة لسنة منتهية (Dr مصروف الرواتب / Cr مخصص 21504) بتسوية الفرق فقط — مرفوض للسنة الجارية والمكرر.',
    permission: 'hr.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        year: { type: 'number', description: 'السنة المنتهية (مثال 2024 — افتراضي السنة الحالية)' },
      },
    },
    summarizeArgs: (a) => {
      const r = a as Record<string, unknown>;
      return `ترحيل مخصص الإجازات لسنة ${String(r.year ?? new Date().getFullYear())}`;
    },
    execute: async (args, ctx) => {
      const year = args.year === undefined ? new Date().getFullYear() : Number(args.year);
      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return { error: 'سنة غير صالحة (2000-2100)' };
      }
      const res = await hrApi.postLeaveProvision(ctx.companyId, year, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل ترحيل المخصص' };
      return {
        posted: true,
        year,
        reference: res.data?.reference,
        employees: res.data?.employees,
        amount: res.data?.amount,
      };
    },
  },
];

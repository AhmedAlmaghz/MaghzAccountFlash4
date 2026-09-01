import type { ToolDefinition } from '../types';
import { salesApi } from '@/modules/sales/api';
import { purchasesApi } from '@/modules/purchases/api';
import { accountingApi } from '@/modules/accounting/api';
import { inventoryApi } from '@/modules/inventory/api';
import { crmApi } from '@/modules/crm/api';
import { hrApi } from '@/modules/hr/api';
import { useAppStore } from '@/core/store';

/**
 * Read-only tools (dangerLevel: 'read') — execute immediately without
 * confirmation. Results are intentionally compact (field-picked, row-capped)
 * to keep LLM context small.
 */

const EMPTY_PARAMS: Record<string, unknown> = { type: 'object', properties: {} };

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const readTools: ToolDefinition[] = [
  // ─── Company ─────────────────────────────────────────────────────────────
  {
    name: 'core.get_company_info',
    labelAr: 'معلومات الشركة',
    descriptionAr: 'يعرض معلومات الشركة الحالية: الاسم، العملة الافتراضية، الرقم الضريبي. استخدمه للإجابة عن أسئلة بيانات الشركة.',
    permission: 'core.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async () => {
      const company = useAppStore.getState().activeCompany;
      if (!company) return { error: 'لا توجد شركة نشطة' };
      return {
        name: company.name,
        nameEn: company.nameEn,
        currency: company.currency,
        taxNumber: company.taxNumber,
        phone: company.phone,
        email: company.email,
      };
    },
  },

  // ─── Sales ───────────────────────────────────────────────────────────────
  {
    name: 'sales.get_sales_summary',
    labelAr: 'ملخص المبيعات',
    descriptionAr: 'يعطي ملخص المبيعات لفترة زمنية: عدد الفواتير، إجمالي المبيعات، المدفوع، المستحق. التواريخ اختيارية بصيغة YYYY-MM-DD — الوضع الافتراضي: الشهر الحالي.',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD (اختياري — افتراضياً بداية الشهر الحالي)' },
        toDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD (اختياري — افتراضياً اليوم)' },
      },
    },
    execute: async (args, ctx) => {
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const from = typeof args.fromDate === 'string' ? args.fromDate : monthStart;
      const to = typeof args.toDate === 'string' ? args.toDate : now.toISOString().split('T')[0];

      const res = await salesApi.getInvoicesPaginated(ctx.companyId, 1, 500, {});
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب الفواتير' };

      const inRange = res.data.items.filter(
        (inv) => inv.status !== 'cancelled' && inv.date >= from && inv.date <= to
      );
      const total = inRange.reduce((s, i) => s + num(i.totalAmount), 0);
      const paid = inRange.reduce((s, i) => s + num(i.paidAmount), 0);
      return {
        period: { from, to },
        invoiceCount: inRange.length,
        totalSales: Math.round(total * 100) / 100,
        totalPaid: Math.round(paid * 100) / 100,
        totalOutstanding: Math.round((total - paid) * 100) / 100,
        note: res.data.total > 500 ? 'البيانات تشمل أول 500 فاتورة فقط' : undefined,
      };
    },
  },
  {
    name: 'sales.get_invoices',
    labelAr: 'فواتير المبيعات',
    descriptionAr: 'يعرض قائمة فواتير المبيعات (رقم الفاتورة، العميل، التاريخ، الإجمالي، المدفوع، الحالة). يمكن التصفية حسب الحالة.',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'posted', 'paid', 'partially_paid', 'cancelled'], description: 'تصفية حسب الحالة (اختياري)' },
        limit: { type: 'number', description: 'عدد النتائج (افتراضي 10، أقصى 25)' },
      },
    },
    execute: async (args, ctx) => {
      const limit = Math.min(Math.max(num(args.limit) || 10, 1), 25);
      const status = typeof args.status === 'string' && args.status ? args.status : undefined;
      const res = await salesApi.getInvoicesPaginated(ctx.companyId, 1, limit, { status });
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب الفواتير' };
      return {
        total: res.data.total,
        invoices: res.data.items.map((i) => ({
          id: i.id,
          number: i.invoiceNumber,
          customer: i.customer?.name,
          date: i.date,
          total: i.totalAmount,
          paid: i.paidAmount,
          status: i.status,
        })),
      };
    },
  },
  {
    name: 'sales.get_ar_aging',
    labelAr: 'أعمار ذمم العملاء',
    descriptionAr: 'يعرض المبالغ المستحقة على العملاء مقسمة حسب فترات التأخير (0-30، 31-60، 61-90، +90 يوم).',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      const res = await salesApi.getCustomerArAging(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب الذمم' };
      const customers = res.data.slice(0, 20).map((c) => ({
        customer: c.customerName,
        totalDue: c.totalDue,
        buckets: Object.fromEntries(c.buckets.map((b) => [b.period, b.amount])),
      }));
      return {
        totalOutstanding: Math.round(res.data.reduce((s, c) => s + num(c.totalDue), 0) * 100) / 100,
        customersCount: res.data.length,
        topCustomers: customers,
      };
    },
  },
  {
    name: 'sales.get_customer_statement',
    labelAr: 'كشف حساب عميل',
    descriptionAr: 'يعرض كشف حساب عميل محدد (الفواتير والسندات والرصيد). يتطلب معرف العميل customerId — استخدم أداة search.customers لإيجاده من الاسم.',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'معرف العميل (UUID)' },
      },
      required: ['customerId'],
    },
    execute: async (args, ctx) => {
      const customerId = String(args.customerId || '');
      if (!customerId) return { error: 'customerId مطلوب' };
      const res = await salesApi.getCustomerStatement(customerId, ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب الكشف' };
      const rows = res.data;
      return {
        rowsCount: rows.length,
        finalBalance: rows.length > 0 ? rows[rows.length - 1].balance : 0,
        statement: rows.slice(-30).map((r) => ({
          date: r.date,
          type: r.documentType,
          number: r.documentNumber,
          debit: r.debit,
          credit: r.credit,
          balance: r.balance,
        })),
      };
    },
  },

  // ─── Purchases ───────────────────────────────────────────────────────────
  {
    name: 'purchases.get_invoices',
    labelAr: 'فواتير المشتريات',
    descriptionAr: 'يعرض قائمة فواتير المشتريات (الرقم، المورد، التاريخ، الإجمالي، الحالة). يمكن التصفية حسب الحالة.',
    permission: 'purchases.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'posted', 'paid', 'partially_paid', 'cancelled'] },
        limit: { type: 'number', description: 'عدد النتائج (افتراضي 10، أقصى 25)' },
      },
    },
    execute: async (args, ctx) => {
      const limit = Math.min(Math.max(num(args.limit) || 10, 1), 25);
      const status = typeof args.status === 'string' && args.status ? args.status : undefined;
      const res = await purchasesApi.getInvoicesPaginated(ctx.companyId, 1, limit, { status });
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب الفواتير' };
      return {
        total: res.data.total,
        invoices: res.data.items.map((i) => ({
          id: i.id,
          number: i.invoiceNumber,
          supplier: i.supplier?.name,
          date: i.date,
          total: i.totalAmount,
          paid: i.paidAmount,
          status: i.status,
        })),
      };
    },
  },
  {
    name: 'purchases.get_ap_aging_total',
    labelAr: 'إجمالي مستحقات الموردين',
    descriptionAr: 'يعطي إجمالي المبالغ المستحقة للموردين (ذمم المشتريات غير المسددة).',
    permission: 'purchases.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      const res = await purchasesApi.getApAgingTotal(ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل الجلب' };
      return { totalOutstandingToSuppliers: res.total ?? 0 };
    },
  },

  // ─── Accounting ──────────────────────────────────────────────────────────
  {
    name: 'accounting.get_trial_balance',
    labelAr: 'ميزان المراجعة',
    descriptionAr: 'يعرض ميزان المراجعة: إجمالي المدين والدائن وأكبر الحسابات رصيداً. استخدمه للأسئلة المالية العامة.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      const res = await accountingApi.getTrialBalance(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب الميزان' };
      const rows = res.data.map((r) => ({
        code: r.accountCode,
        name: r.accountName,
        debit: num(r.debit),
        credit: num(r.credit),
        balance: num(r.balance),
      }));
      const top = [...rows].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)).slice(0, 15);
      return {
        totalDebit: Math.round(rows.reduce((s, r) => s + r.debit, 0) * 100) / 100,
        totalCredit: Math.round(rows.reduce((s, r) => s + r.credit, 0) * 100) / 100,
        accountsCount: rows.length,
        topAccounts: top,
      };
    },
  },
  {
    name: 'accounting.get_profit_loss',
    labelAr: 'قائمة الدخل',
    descriptionAr: 'يعرض قائمة الدخل (الإيرادات والمصروفات وصافي الربح) لفترة زمنية. التواريخ اختيارية بصيغة YYYY-MM-DD.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: 'YYYY-MM-DD (اختياري)' },
        toDate: { type: 'string', description: 'YYYY-MM-DD (اختياري)' },
      },
    },
    execute: async (args, ctx) => {
      const from = typeof args.fromDate === 'string' ? args.fromDate : undefined;
      const to = typeof args.toDate === 'string' ? args.toDate : undefined;
      const res = await accountingApi.getProfitLoss(ctx.companyId, from, to);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب قائمة الدخل' };
      const rows = res.data.map((a) => ({
        code: a.code,
        name: a.nameAr || a.nameEn || '',
        type: a.type,
        balance: num(a.balance),
      }));
      const revenue = rows.filter((r) => r.type === 'revenue').reduce((s, r) => s + r.balance, 0);
      const expenses = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.balance, 0);
      return {
        period: { from, to },
        totalRevenue: Math.round(revenue * 100) / 100,
        totalExpenses: Math.round(expenses * 100) / 100,
        netProfit: Math.round((revenue - expenses) * 100) / 100,
        topAccounts: [...rows].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)).slice(0, 12),
      };
    },
  },

  // ─── Inventory ───────────────────────────────────────────────────────────
  {
    name: 'inventory.get_products',
    labelAr: 'قائمة المنتجات',
    descriptionAr: 'يعرض قائمة المنتجات (الكود، الاسم، سعر البيع، سعر التكلفة، الكمية). يمكن البحث بالاسم أو الكود.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'نص البحث (اختياري)' },
        limit: { type: 'number', description: 'عدد النتائج (افتراضي 10، أقصى 25)' },
      },
    },
    execute: async (args, ctx) => {
      const limit = Math.min(Math.max(num(args.limit) || 10, 1), 25);
      const search = typeof args.search === 'string' && args.search ? args.search : undefined;
      const res = await inventoryApi.getProductsPaginated(ctx.companyId, 1, limit, { search });
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب المنتجات' };
      return {
        total: res.data.total,
        products: res.data.items.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.nameAr,
          salePrice: p.salePrice,
          costPrice: p.costPrice,
          quantity: p.quantity,
          unit: p.unitName || p.unit,
        })),
      };
    },
  },
  {
    name: 'inventory.get_low_stock',
    labelAr: 'المنتجات منخفضة المخزون',
    descriptionAr: 'يعرض المنتجات التي وصلت أو انخفضت عن حد التنبيه في المخزون.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      const res = await inventoryApi.getStockDetailed(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب المخزون' };
      const low = res.data.filter((s) => num(s.minStockAlert) > 0 && num(s.quantity) <= num(s.minStockAlert));
      return {
        lowStockCount: low.length,
        items: low.slice(0, 25).map((s) => ({
          product: s.productName,
          code: s.productCode,
          warehouse: s.warehouseName,
          quantity: s.quantity,
          minAlert: s.minStockAlert,
        })),
      };
    },
  },

  // ─── CRM ─────────────────────────────────────────────────────────────────
  {
    name: 'crm.get_leads',
    labelAr: 'العملاء المحتملين',
    descriptionAr: 'يعرض قائمة العملاء المحتملين (الاسم، الهاتف، الحالة، التقييم، القيمة المتوقعة).',
    permission: 'crm.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['new', 'contacted', 'qualified', 'converted', 'lost'] },
      },
    },
    execute: async (args, ctx) => {
      const res = await crmApi.getLeads(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب العملاء' };
      const status = typeof args.status === 'string' && args.status ? args.status : undefined;
      const filtered = status ? res.data.filter((l) => l.status === status) : res.data;
      return {
        total: filtered.length,
        leads: filtered.slice(0, 20).map((l) => ({
          id: l.id,
          name: l.name,
          phone: l.phone,
          status: l.status,
          rating: l.rating,
          estimatedValue: l.estimatedValue,
          assignedTo: l.assignedName,
        })),
      };
    },
  },
  {
    name: 'crm.get_opportunities',
    labelAr: 'الفرص البيعية',
    descriptionAr: 'يعرض الفرص البيعية وقيمة خط الأنابيب (pipeline) حسب المرحلة.',
    permission: 'crm.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      const res = await crmApi.getOpportunities(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب الفرص' };
      const open = res.data.filter((o) => o.stage !== 'won' && o.stage !== 'lost');
      const pipelineValue = open.reduce((s, o) => s + num(o.value), 0);
      const weighted = open.reduce((s, o) => s + num(o.value) * (num(o.probability) / 100), 0);
      return {
        openCount: open.length,
        pipelineValue: Math.round(pipelineValue * 100) / 100,
        weightedValue: Math.round(weighted * 100) / 100,
        opportunities: res.data.slice(0, 20).map((o) => ({
          id: o.id,
          name: o.name,
          value: o.value,
          stage: o.stage,
          probability: o.probability,
        })),
      };
    },
  },
  {
    name: 'crm.get_tasks',
    labelAr: 'مهام المتابعة',
    descriptionAr: 'يعرض قائمة مهام المتابعة (العنوان، الأولوية، الحالة، تاريخ الاستحقاق، هل متأخرة). يمكن الفلترة بالحالة والأولوية.',
    permission: 'crm.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'completed', 'cancelled'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
    },
    execute: async (args, ctx) => {
      const res = await crmApi.getTasks(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب المهام' };
      const status = typeof args.status === 'string' && args.status ? args.status : undefined;
      const priority = typeof args.priority === 'string' && args.priority ? args.priority : undefined;
      let filtered = res.data;
      if (status) filtered = filtered.filter((t) => t.status === status);
      if (priority) filtered = filtered.filter((t) => t.priority === priority);
      const todayStr = new Date(new Date().toDateString());
      return {
        total: filtered.length,
        overdue: filtered.filter((t) => t.status === 'pending' && t.dueDate && new Date(t.dueDate) < todayStr).length,
        tasks: filtered.slice(0, 20).map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate,
          overdue: t.status === 'pending' && !!t.dueDate && new Date(t.dueDate) < todayStr,
          assignedTo: t.assignedName,
          leadId: t.leadId,
          opportunityId: t.opportunityId,
          customerId: t.customerId,
        })),
      };
    },
  },
  {
    name: 'crm.get_activities',
    labelAr: 'سجل الأنشطة',
    descriptionAr: 'يعرض سجل أنشطة التواصل (اتصالات، اجتماعات، زيارات). يمكن الفلترة بالنوع.',
    permission: 'crm.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['call', 'meeting', 'email', 'visit', 'note'] },
      },
    },
    execute: async (args, ctx) => {
      const res = await crmApi.getActivities(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب الأنشطة' };
      const type = typeof args.type === 'string' && args.type ? args.type : undefined;
      const filtered = type ? res.data.filter((a) => a.type === type) : res.data;
      return {
        total: filtered.length,
        activities: filtered.slice(0, 20).map((a) => ({
          id: a.id,
          type: a.type,
          subject: a.subject,
          activityDate: a.activityDate,
          durationMinutes: a.durationMinutes,
          assignedTo: a.assignedName,
          leadId: a.leadId,
          opportunityId: a.opportunityId,
          customerId: a.customerId,
        })),
      };
    },
  },

  // ─── HR ──────────────────────────────────────────────────────────────────
  {
    name: 'hr.get_employees',
    labelAr: 'قائمة الموظفين',
    descriptionAr: 'يعرض قائمة الموظفين (الرقم، الاسم، القسم، المنصب، الراتب الأساسي، الحالة).',
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      const res = await hrApi.getEmployees(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب الموظفين' };
      const active = res.data.filter((e) => e.isActive);
      return {
        totalEmployees: res.data.length,
        activeEmployees: active.length,
        employees: res.data.slice(0, 25).map((e) => ({
          id: e.id,
          number: e.employeeNumber,
          name: e.fullName,
          department: e.departmentName,
          position: e.position,
          baseSalary: e.baseSalary,
          isActive: e.isActive,
        })),
      };
    },
  },

  // ─── AI Analytics Read Tools ─────────────────────────────────────────────
  {
    name: 'read.inventory_valuation',
    labelAr: 'تقييم المخزون',
    descriptionAr: 'يعرض تقييم المخزون: إجمالي قيمة المخزون حسب المنتج مع سعر التكلفة والكمية والقيمة الإجمالية لكل منتج.',
    permission: 'ai.use',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      const res = await inventoryApi.getProducts(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب المخزون' };
      const withStock = res.data.filter((p) => num(p.quantity) > 0 || num(p.costPrice) > 0);
      const totalValue = withStock.reduce((s, p) => s + num(p.quantity) * num(p.costPrice), 0);
      return {
        totalValue: Math.round(totalValue * 100) / 100,
        productCount: withStock.length,
        products: withStock.slice(0, 25).map((p) => ({
          code: p.code,
          name: p.nameAr || p.nameEn,
          quantity: p.quantity,
          costPrice: p.costPrice,
          lineValue: Math.round(num(p.quantity) * num(p.costPrice) * 100) / 100,
        })),
      };
    },
  },
  {
    name: 'read.low_stock_alert',
    labelAr: 'تنبيه المخزون المنخفض',
    descriptionAr: 'يعرض المنتجات التي وصلت أو انخفضت عن حد التنبيه في المخزون.',
    permission: 'ai.use',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      const res = await inventoryApi.getStockDetailed(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب المخزون' };
      const low = res.data.filter((s) => num(s.minStockAlert) > 0 && num(s.quantity) <= num(s.minStockAlert));
      return {
        lowStockCount: low.length,
        items: low.slice(0, 25).map((s) => ({
          product: s.productName,
          code: s.productCode,
          warehouse: s.warehouseName,
          quantity: s.quantity,
          minAlert: s.minStockAlert,
        })),
      };
    },
  },
  {
    name: 'read.sales_analysis',
    labelAr: 'تحليل المبيعات',
    descriptionAr: 'يحلل المبيعات حسب المنتج والعميل والفترة. يمكن تحديد الفترة والحد الأعلى للنتائج.',
    permission: 'ai.use',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD (اختياري)' },
        toDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD (اختياري)' },
        limit: { type: 'number', description: 'عدد النتائج (افتراضي 10، أقصى 25)' },
      },
    },
    execute: async (args, ctx) => {
      const limit = Math.min(Math.max(num(args.limit) || 10, 1), 25);
      const now = new Date();
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const from = typeof args.fromDate === 'string' ? args.fromDate : monthStart;
      const to = typeof args.toDate === 'string' ? args.toDate : now.toISOString().split('T')[0];
      const res = await salesApi.getInvoicesPaginated(ctx.companyId, 1, 200, {});
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب المبيعات' };
      const inRange = res.data.items.filter((i) => i.status !== 'cancelled' && i.date >= from && i.date <= to);
      const total = inRange.reduce((s, i) => s + num(i.totalAmount), 0);
      const byCustomer = new Map<string, { count: number; total: number }>();
      for (const inv of inRange) {
        const key = inv.customer?.name || 'غير معروف';
        const prev = byCustomer.get(key) || { count: 0, total: 0 };
        byCustomer.set(key, { count: prev.count + 1, total: prev.total + num(inv.totalAmount) });
      }
      const topCustomers = [...byCustomer.entries()]
        .map(([name, v]) => ({ customer: name, invoices: v.count, total: Math.round(v.total * 100) / 100 }))
        .sort((a, b) => b.total - a.total)
        .slice(0, limit);
      return {
        period: { from, to },
        invoiceCount: inRange.length,
        totalSales: Math.round(total * 100) / 100,
        averagePerInvoice: inRange.length ? Math.round((total / inRange.length) * 100) / 100 : 0,
        topCustomers,
      };
    },
  },
  {
    name: 'read.customer_statement',
    labelAr: 'كشف حساب عميل',
    descriptionAr: 'يعرض كشف حساب تفصيلي لعميل (الفواتير والسندات والرصيد التراكمي). يتطلب customerId.',
    permission: 'ai.use',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'معرف العميل (UUID)' },
      },
      required: ['customerId'],
    },
    execute: async (args, ctx) => {
      const customerId = String(args.customerId || '');
      if (!customerId) return { error: 'customerId مطلوب' };
      const res = await salesApi.getCustomerStatement(customerId, ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب الكشف' };
      const rows = res.data;
      return {
        rowsCount: rows.length,
        finalBalance: rows.length > 0 ? rows[rows.length - 1].balance : 0,
        statement: rows.slice(-30).map((r) => ({
          date: r.date,
          type: r.documentType,
          number: r.documentNumber,
          debit: r.debit,
          credit: r.credit,
          balance: r.balance,
        })),
      };
    },
  },
  {
    name: 'read.supplier_statement',
    labelAr: 'كشف حساب مورد',
    descriptionAr: 'يعرض كشف حساب تفصيلي لمورد (الفواتير والسندات والرصيد التراكمي). يتطلب supplierId.',
    permission: 'ai.use',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        supplierId: { type: 'string', description: 'معرف المورد (UUID)' },
      },
      required: ['supplierId'],
    },
    execute: async (args, ctx) => {
      const supplierId = String(args.supplierId || '');
      if (!supplierId) return { error: 'supplierId مطلوب' };
      const res = await purchasesApi.getSupplierStatement(supplierId, ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب الكشف' };
      const rows = res.data;
      return {
        rowsCount: rows.length,
        finalBalance: rows.length > 0 ? rows[rows.length - 1].balance : 0,
        statement: rows.slice(-30).map((r) => ({
          date: r.date,
          type: r.type,
          number: r.documentNumber,
          debit: r.debit,
          credit: r.credit,
          balance: r.balance,
        })),
      };
    },
  },
  {
    name: 'read.employee_payroll_history',
    labelAr: 'سجل رواتب الموظف',
    descriptionAr: 'يعرض سجل مسيرات الرواتب لموظف معين مع التفاصيل (الراتب الأساسي، البدلات، الخصومات، صافي الراتب). يمكن تحديد الموظف أو عرض آخر المسيرات.',
    permission: 'ai.use',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        employeeId: { type: 'string', description: 'معرف الموظف (UUID، اختياري — إذا لم يُحدد يعرض آخر 6 مسيرات)' },
        limit: { type: 'number', description: 'عدد مسيرات الرواتب (افتراضي 6، أقصى 12)' },
      },
    },
    execute: async (args, ctx) => {
      const limit = Math.min(Math.max(num(args.limit) || 6, 1), 12);
      const employeeId = args.employeeId ? String(args.employeeId) : undefined;
      const res = await hrApi.getPayrollRuns(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب مسيرات الرواتب' };
      const runs = res.data
        .sort((a, b) => b.year - a.year || b.month - a.month)
        .slice(0, limit);
      const all = runs.map((r) => {
        const empLines = employeeId ? r.lines.filter((l) => l.employeeId === employeeId) : r.lines;
        return {
          runLabel: `${r.month}/${r.year}`,
          status: r.status,
          totalAmount: r.totalAmount,
          lines: empLines.slice(0, 10).map((l) => ({
            employee: l.employeeName,
            baseSalary: l.baseSalary,
            allowances: l.allowances,
            deductions: l.deductions,
            overtime: l.overtime,
            netSalary: l.netSalary,
          })),
        };
      });
      return { runs: all };
    },
  },
  {
    name: 'read.attendance_summary',
    labelAr: 'ملخص الحضور',
    descriptionAr: 'يعرض ملخص الحضور والانصراف لفترة محددة (عدد الحاضرين، الغائبين، المتأخرين، في إجازة ونسبة الحضور). يمكن تحديد الشهر والسنة.',
    permission: 'ai.use',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'number', description: 'رقم الشهر (1-12، افتراضي الشهر الحالي)' },
        year: { type: 'number', description: 'السنة (افتراضي السنة الحالية)' },
      },
    },
    execute: async (args, ctx) => {
      const now = new Date();
      const month = num(args.month) || (now.getMonth() + 1);
      const year = num(args.year) || now.getFullYear();
      const res = await hrApi.getAttendance(ctx.companyId, month, year);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب الحضور' };
      const records = res.data;
      const present = records.filter((r) => r.status === 'present').length;
      const absent = records.filter((r) => r.status === 'absent').length;
      const late = records.filter((r) => r.status === 'late').length;
      const onLeave = records.filter((r) => r.status === 'on_leave').length;
      return {
        period: `${month}/${year}`,
        totalRecords: records.length,
        present,
        absent,
        late,
        onLeave,
        attendanceRate: records.length ? Math.round((present / records.length) * 10000) / 100 : 0,
        details: records.slice(0, 20).map((r) => ({
          employee: r.employeeName,
          date: r.date,
          checkIn: r.checkIn,
          checkOut: r.checkOut,
          status: r.status,
        })),
      };
    },
  },
  {
    name: 'read.end_of_service',
    labelAr: 'مكافأة نهاية الخدمة',
    descriptionAr: 'يعرض تفاصيل مكافأة نهاية الخدمة للموظفين (الراتب الأخير، سنوات الخدمة، قيمة المكافأة، سبب الاستحقاق، الحالة). يمكن التصفية بمعرف الموظف.',
    permission: 'ai.use',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        employeeId: { type: 'string', description: 'معرف الموظف (UUID، اختياري)' },
      },
    },
    execute: async (args, ctx) => {
      const employeeId = args.employeeId ? String(args.employeeId) : undefined;
      const res = await hrApi.getEndOfServices(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب نهاية الخدمة' };
      let filtered = res.data;
      if (employeeId) filtered = filtered.filter((e) => e.employeeId === employeeId);
      const totalEos = filtered.reduce((s, e) => s + num(e.eosAmount), 0);
      return {
        totalCalculations: filtered.length,
        totalEosAmount: Math.round(totalEos * 100) / 100,
        items: filtered.slice(0, 20).map((e) => ({
          employee: e.employeeName,
          terminationDate: e.terminationDate,
          serviceYears: e.serviceYears,
          lastSalary: e.lastSalary,
          eosAmount: e.eosAmount,
          reason: e.reason,
          status: e.status,
        })),
      };
    },
  },
  {
    name: 'read.ar_aging',
    labelAr: 'أعمار ذمم العملاء',
    descriptionAr: 'يعرض تحليل أعمار الذمم المدينة (المستحق على العملاء حسب الفترات: 0-30، 31-60، 61-90، +90 يوم).',
    permission: 'ai.use',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      const res = await salesApi.getCustomerArAging(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب الذمم' };
      const customers = res.data.slice(0, 20).map((c) => ({
        customer: c.customerName,
        totalDue: c.totalDue,
        buckets: Object.fromEntries(c.buckets.map((b) => [b.period, b.amount])),
      }));
      return {
        totalOutstanding: Math.round(res.data.reduce((s, c) => s + num(c.totalDue), 0) * 100) / 100,
        customersCount: res.data.length,
        topCustomers: customers,
      };
    },
  },
  {
    name: 'read.ap_aging',
    labelAr: 'أعمار ذمم الموردين',
    descriptionAr: 'يعرض إجمالي المبالغ المستحقة للموردين (ذمم المشتريات غير المسددة).',
    permission: 'ai.use',
    dangerLevel: 'read',
    parameters: EMPTY_PARAMS,
    execute: async (_args, ctx) => {
      const res = await purchasesApi.getApAgingTotal(ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل الجلب' };
      return { totalOutstandingToSuppliers: res.total ?? 0 };
    },
  },
  {
    name: 'read.balance_sheet',
    labelAr: 'الميزانية العمومية',
    descriptionAr: 'يعرض الميزانية العمومية (قائمة المركز المالي) — الأصول، الخصوم، حقوق الملكية حتى تاريخ معين.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        asOfDate: { type: 'string', description: 'تاريخ القطع (YYYY-MM-DD) — اختياري، افتراضي اليوم' },
      },
    },
    execute: async (args, ctx) => {
      const res = await accountingApi.getBalanceSheet(ctx.companyId, args.asOfDate ? String(args.asOfDate) : undefined);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب الميزانية' };
      const assets = res.data.filter((a) => a.type === 'asset') || [];
      const liabilities = res.data.filter((a) => a.type === 'liability') || [];
      const equity = res.data.filter((a) => a.type === 'equity') || [];
      return {
        asOfDate: args.asOfDate || new Date().toISOString().split('T')[0],
        totalAssets: Math.round(assets.reduce((s, a) => s + Number(a.balance || 0), 0) * 100) / 100,
        totalLiabilities: Math.round(liabilities.reduce((s, a) => s + Number(a.balance || 0), 0) * 100) / 100,
        totalEquity: Math.round(equity.reduce((s, a) => s + Number(a.balance || 0), 0) * 100) / 100,
        assets: assets.slice(0, 15).map((a) => ({ code: a.code, name: a.nameAr || a.nameEn, balance: a.balance })),
        liabilities: liabilities.slice(0, 15).map((a) => ({ code: a.code, name: a.nameAr || a.nameEn, balance: a.balance })),
        equity: equity.slice(0, 10).map((a) => ({ code: a.code, name: a.nameAr || a.nameEn, balance: a.balance })),
      };
    },
  },
  {
    name: 'read.profit_loss',
    labelAr: 'قائمة الدخل (أرباح/خسائر)',
    descriptionAr: 'يعرض قائمة الدخل لفترة محددة — الإيرادات والمصروفات وصافي الربح/الخسارة.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD (اختياري)' },
        endDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD (اختياري)' },
      },
    },
    execute: async (args, ctx) => {
      const startDate = typeof args.startDate === 'string' ? args.startDate : undefined;
      const endDate = typeof args.endDate === 'string' ? args.endDate : undefined;
      const res = await accountingApi.getProfitLoss(ctx.companyId, startDate, endDate);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب قائمة الدخل' };
      const income = res.data.filter((a) => a.type === 'revenue') || [];
      const expenses = res.data.filter((a) => a.type === 'expense') || [];
      const totalIncome = Math.round(income.reduce((s, a) => s + Number(a.balance || 0), 0) * 100) / 100;
      const totalExpenses = Math.round(expenses.reduce((s, a) => s + Number(a.balance || 0), 0) * 100) / 100;
      return {
        period: { start: startDate || 'بداية العام', end: endDate || 'اليوم' },
        totalIncome,
        totalExpenses,
        netProfit: Math.round((totalIncome - totalExpenses) * 100) / 100,
        incomeItems: income.slice(0, 15).map((a) => ({ code: a.code, name: a.nameAr || a.nameEn, amount: a.balance })),
        expenseItems: expenses.slice(0, 15).map((a) => ({ code: a.code, name: a.nameAr || a.nameEn, amount: a.balance })),
      };
    },
  },
  // ─── HR: KPIs ────────────────────────────────────────────────────────────
  {
    name: 'read.hr_kpis',
    labelAr: 'مؤشرات الموارد البشرية',
    descriptionAr: 'يعرض مؤشرات HR الرئيسية: عدد الموظفين، نسبة الحضور، إجمالي مسيرات الرواتب، إلخ.',
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const res = await hrApi.getHrKpis(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب مؤشرات HR' };
      return {
        totalEmployees: res.data.totalEmployees,
        activeEmployees: res.data.activeEmployees,
        pendingLeaves: res.data.pendingLeaves,
        totalPayrollAmount: res.data.totalPayrollAmount,
      };
    },
  },
  // ─── Inventory: KPIs ─────────────────────────────────────────────────────
  {
    name: 'read.inventory_kpis',
    labelAr: 'مؤشرات المخزون',
    descriptionAr: 'يعرض مؤشرات المخزون الرئيسية: قيمة المخزون، عدد المنتجات منخفضة المخزون، عدد المستودعات، عدد حركات المخزون.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const res = await inventoryApi.getInventoryKpis(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب مؤشرات المخزون' };
      return res.data;
    },
  },
];

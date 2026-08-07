import type { ToolDefinition } from '../types';
import { salesApi } from '@/modules/sales/api';
import { purchasesApi } from '@/modules/purchases/api';
import { inventoryApi } from '@/modules/inventory/api';
import { accountingApi } from '@/modules/accounting/api';
import { crmApi } from '@/modules/crm/api';
import { hrApi } from '@/modules/hr/api';
import { manufacturingApi } from '@/modules/manufacturing/api';
import type { Account } from '@/modules/accounting/types';
import * as settingsApi from '@/core/api';
import { normalizeArabic, findAllFuzzyMatches } from '@/core/utils/normalizeArabic';

/**
 * Cap for fuzzy-match fetches. Datasets are small enough that fetching all rows
 * + fuzzy-matching in JS is faster and more reliable than ILIKE-with-normalized
 * pattern (which silently fails because PG stores raw characters while our
 * normalized pattern uses alef/yeh/teh variants).
 */
const FUZZY_FETCH_LIMIT = 200;

/**
 * Search tools — resolve human names ("العميل محمد") to entity IDs.
 * The LLM must call these BEFORE any tool that takes an entity ID.
 */

function searchParam(description: string): Record<string, unknown> {
  return {
    type: 'object',
    properties: { query: { type: 'string', description } },
    required: ['query'],
  };
}

/**
 * Normalise an Arabic query for search — strips diacritics, collapses alef/hamza/yeh/teh
 * variants into a common form so common typos and dialectal differences are tolerated.
 */
function normalizeQuery(query: string): string {
  return normalizeArabic(query);
}

/** Flatten the hierarchical accounts tree for text search. */
function flattenAccounts(accounts: Account[]): Account[] {
  const out: Account[] = [];
  const walk = (list: Account[]) => {
    for (const a of list) {
      out.push(a);
      if (a.children?.length) walk(a.children);
    }
  };
  walk(accounts);
  return out;
}

export const searchTools: ToolDefinition[] = [
  {
    name: 'search.customers',
    labelAr: 'بحث عن عميل',
    descriptionAr: 'يبحث عن عميل بالاسم ويعيد معرفه (id) وبياناته. استخدمه دائماً قبل أي عملية تحتاج معرف عميل.',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: searchParam('اسم العميل أو جزء منه'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim();
      if (!query) return { error: 'نص البحث مطلوب' };
      const res = await salesApi.getCustomersPaginated(ctx.companyId, 1, FUZZY_FETCH_LIMIT);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const matches = findAllFuzzyMatches(
        query,
        res.data.items,
        (c) => `${c.name} ${c.phone ?? ''} ${c.code ?? ''}`,
        0.35,
      ).slice(0, 8);
      return {
        matches: matches.map((m) => ({
          id: m.item.id,
          name: m.item.name,
          phone: m.item.phone,
          balance: m.item.balance,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.suppliers',
    labelAr: 'بحث عن مورد',
    descriptionAr: 'يبحث عن مورد بالاسم ويعيد معرفه (id) وبياناته. استخدمه دائماً قبل أي عملية تحتاج معرف مورد.',
    permission: 'purchases.view',
    dangerLevel: 'read',
    parameters: searchParam('اسم المورد أو جزء منه'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim();
      if (!query) return { error: 'نص البحث مطلوب' };
      const res = await purchasesApi.getSuppliersPaginated(ctx.companyId, 1, FUZZY_FETCH_LIMIT);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const matches = findAllFuzzyMatches(
        query,
        res.data.items,
        (s) => `${s.name} ${s.phone ?? ''} ${s.code ?? ''}`,
        0.35,
      ).slice(0, 8);
      return {
        matches: matches.map((m) => ({
          id: m.item.id,
          name: m.item.name,
          phone: m.item.phone,
          balance: m.item.balance,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.products',
    labelAr: 'بحث عن منتج',
    descriptionAr: 'يبحث عن منتج بالاسم أو الكود ويعيد معرفه (id) وسعر البيع وسعر التكلفة. استخدمه دائماً قبل أي عملية تحتاج معرف منتج.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: searchParam('اسم المنتج أو كوده أو جزء منه'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim();
      if (!query) return { error: 'نص البحث مطلوب' };
      const res = await inventoryApi.getProductsPaginated(ctx.companyId, 1, FUZZY_FETCH_LIMIT);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const matches = findAllFuzzyMatches(
        query,
        res.data.items,
        (p) => `${p.nameAr ?? ''} ${p.nameEn ?? ''} ${p.code ?? ''} ${p.barcode ?? ''} ${p.sku ?? ''}`,
        0.35,
      ).slice(0, 8);
      return {
        matches: matches.map((m) => ({
          id: m.item.id,
          code: m.item.code,
          name: m.item.nameAr,
          salePrice: m.item.salePrice,
          costPrice: m.item.costPrice,
          quantity: m.item.quantity,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.accounts',
    labelAr: 'بحث عن حساب',
    descriptionAr: 'يبحث في شجرة الحسابات بالكود أو الاسم ويعيد معرف الحساب (id) ونوعه. استخدمه قبل أي عملية محاسبية تحتاج معرف حساب.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: searchParam('كود الحساب أو اسمه أو جزء منه'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const cleanQuery = normalizeQuery(query);
      const res = await accountingApi.getAccounts(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const flat = flattenAccounts(res.data);
      const matches = flat
        .filter(
          (a) =>
            String(a.code ?? '').toLowerCase().includes(cleanQuery) ||
            normalizeQuery(a.nameAr).includes(cleanQuery) ||
            (a.nameEn || '').toLowerCase().includes(cleanQuery)
        )
        .slice(0, 8);
      return {
        matches: matches.map((a) => ({
          id: a.id,
          code: a.code,
          name: a.nameAr,
          type: a.type,
          isGroup: a.isGroup,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.leads',
    labelAr: 'بحث عن عميل محتمل',
    descriptionAr: 'يبحث عن عميل محتمل (lead) بالاسم أو البريد أو الهاتف ويعيد معرفه (id) وحالته. استخدمه قبل crm.create_opportunity أو crm.update_lead_status.',
    permission: 'crm.view',
    dangerLevel: 'read',
    parameters: searchParam('اسم العميل المحتمل أو بريده أو هاتفه'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim();
      if (!query) return { error: 'نص البحث مطلوب' };
      const res = await crmApi.getLeadsPaginated(ctx.companyId, 1, FUZZY_FETCH_LIMIT);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const matches = findAllFuzzyMatches(
        query,
        res.data.items,
        (l) => `${l.name} ${l.phone ?? ''} ${l.email ?? ''}`,
        0.35,
      ).slice(0, 8);
      return {
        matches: matches.map((m) => ({
          id: m.item.id,
          name: m.item.name,
          phone: m.item.phone,
          status: m.item.status,
          estimatedValue: m.item.estimatedValue,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.opportunities',
    labelAr: 'بحث عن فرصة بيعية',
    descriptionAr: 'يبحث عن فرصة بيعية بالاسم ويعيد معرفها (id) ومرحلتها وقيمتها. استخدمه قبل crm.update_opportunity_stage.',
    permission: 'crm.view',
    dangerLevel: 'read',
    parameters: searchParam('اسم الفرصة البيعية'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim();
      if (!query) return { error: 'نص البحث مطلوب' };
      const res = await crmApi.getOpportunitiesPaginated(ctx.companyId, 1, FUZZY_FETCH_LIMIT);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const matches = findAllFuzzyMatches(
        query,
        res.data.items,
        (o) => o.name,
        0.35,
      ).slice(0, 8);
      return {
        matches: matches.map((m) => ({
          id: m.item.id,
          name: m.item.name,
          stage: m.item.stage,
          value: m.item.value,
          probability: m.item.probability,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.employees',
    labelAr: 'بحث عن موظف',
    descriptionAr: 'يبحث عن موظف بالاسم أو رقم الموظف أو البريد ويعيد معرفه (id) وبياناته. استخدمه قبل hr.create_employee أو أي عملية HR.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: searchParam('اسم الموظف أو رقمه أو بريده'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim();
      if (!query) return { error: 'نص البحث مطلوب' };
      const res = await hrApi.getEmployeesPaginated(ctx.companyId, 1, FUZZY_FETCH_LIMIT);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const matches = findAllFuzzyMatches(
        query,
        res.data.items,
        (e) => `${e.fullName ?? ''} ${e.employeeNumber ?? ''} ${e.email ?? ''}`,
        0.35,
      ).slice(0, 8);
      return {
        matches: matches.map((m) => ({
          id: m.item.id,
          name: m.item.fullName,
          employeeNumber: m.item.employeeNumber,
          phone: m.item.phone,
          position: m.item.position,
          isActive: m.item.isActive,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.quotations',
    labelAr: 'بحث عن عرض سعر',
    descriptionAr: 'يبحث عن عرض سعر برقم العرض أو اسم العميل ويعيد معرفه (id) وحالته.',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: searchParam('رقم عرض السعر أو جزء من اسم العميل'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const cleanQuery = normalizeQuery(query);
      const res = await salesApi.getQuotations(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const matches = res.data
        .filter((q) =>
          q.quotationNumber.toLowerCase().includes(cleanQuery) ||
          normalizeQuery(q.customer?.name || '').includes(cleanQuery)
        )
        .slice(0, 8);
      return {
        matches: matches.map((q) => ({
          id: q.id,
          quotationNumber: q.quotationNumber,
          customerName: q.customer?.name,
          totalAmount: q.totalAmount,
          status: q.status,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.warehouses',
    labelAr: 'بحث عن مستودع',
    descriptionAr: 'يبحث عن مستودع بالاسم ويعيد معرفه (id). استخدمه قبل inventory.create_stock_adjustment.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: searchParam('اسم المستودع'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const cleanQuery = normalizeQuery(query);
      const res = await inventoryApi.getWarehouses(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const matches = res.data
        .filter((w) => normalizeQuery(w.name).includes(cleanQuery))
        .slice(0, 8);
      return {
        matches: matches.map((w) => ({ id: w.id, name: w.name, isActive: w.isActive })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.sales_invoices',
    labelAr: 'بحث عن فاتورة مبيعات',
    descriptionAr: 'يبحث عن فاتورة مبيعات برقم الفاتورة أو اسم العميل ويعيد معرفها (id) وحالتها ومبلغها. استخدمه قبل sales.create_sales_return أو sales.post_invoice.',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: searchParam('رقم الفاتورة أو اسم العميل'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const cleanQuery = normalizeQuery(query);
      const res = await salesApi.getInvoices(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const matches = res.data
        .filter((inv) => {
          const n = (inv.invoiceNumber || '').toLowerCase();
          const c = normalizeQuery(inv.customer?.name || '');
          return n.includes(cleanQuery) || c.includes(cleanQuery);
        })
        .slice(0, 8);
      return {
        matches: matches.map((inv) => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          customerName: inv.customer?.name,
          status: inv.status,
          totalAmount: inv.totalAmount,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.purchase_invoices',
    labelAr: 'بحث عن فاتورة مشتريات',
    descriptionAr: 'يبحث عن فاتورة مشتريات برقم الفاتورة أو اسم المورد ويعيد معرفها (id) وحالتها ومبلغها. استخدمه قبل purchases.create_purchase_return أو purchases.post_invoice.',
    permission: 'purchases.view',
    dangerLevel: 'read',
    parameters: searchParam('رقم الفاتورة أو اسم المورد'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const cleanQuery = normalizeQuery(query);
      const res = await purchasesApi.getInvoices(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const matches = res.data
        .filter((inv) => {
          const n = (inv.invoiceNumber || '').toLowerCase();
          const s = normalizeQuery(inv.supplier?.name || '');
          return n.includes(cleanQuery) || s.includes(cleanQuery);
        })
        .slice(0, 8);
      return {
        matches: matches.map((inv) => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          supplierName: inv.supplier?.name,
          status: inv.status,
          totalAmount: inv.totalAmount,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.purchase_orders',
    labelAr: 'بحث عن أمر شراء',
    descriptionAr: 'يبحث عن أمر شراء برقم الأمر أو اسم المورد ويعيد معرفه (id) وحالته. استخدمه قبل purchases.convert_order_to_invoice.',
    permission: 'purchases.view',
    dangerLevel: 'read',
    parameters: searchParam('رقم الأمر أو اسم المورد'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const cleanQuery = normalizeQuery(query);
      const res = await purchasesApi.getOrders(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const matches = res.data
        .filter((o) => {
          const n = (o.orderNumber || '').toLowerCase();
          const s = normalizeQuery(o.supplier?.name || '');
          return n.includes(cleanQuery) || s.includes(cleanQuery);
        })
        .slice(0, 8);
      return {
        matches: matches.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          supplierName: o.supplier?.name,
          status: o.status,
          totalAmount: o.totalAmount,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.boms',
    labelAr: 'بحث عن شجرة منتج',
    descriptionAr: 'يبحث عن شجرة منتج (BOM) باسم المنتج أو الإصدار ويعيد معرفها (id) وتكلفتها الإجمالية.',
    permission: 'manufacturing.view',
    dangerLevel: 'read',
    parameters: searchParam('اسم المنتج أو رقم الإصدار'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const cleanQuery = normalizeQuery(query);
      const res = await manufacturingApi.getBoms(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const matches = res.data
        .filter((b) =>
          normalizeQuery(b.productName || '').includes(cleanQuery) ||
          b.version.toLowerCase().includes(cleanQuery)
        )
        .slice(0, 8);
      return {
        matches: matches.map((b) => ({
          id: b.id,
          productName: b.productName,
          version: b.version,
          isActive: b.isActive,
          totalCost: b.totalCost,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.work_orders',
    labelAr: 'بحث عن أمر تشغيل',
    descriptionAr: 'يبحث عن أمر تشغيل برقم الأمر أو اسم المنتج ويعيد معرفه (id) وحالته وكميته.',
    permission: 'manufacturing.view',
    dangerLevel: 'read',
    parameters: searchParam('رقم أمر التشغيل أو اسم المنتج'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const cleanQuery = normalizeQuery(query);
      const res = await manufacturingApi.getWorkOrders(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const matches = res.data
        .filter((w) =>
          w.orderNumber.toLowerCase().includes(cleanQuery) ||
          normalizeQuery(w.productName || '').includes(cleanQuery)
        )
        .slice(0, 8);
      return {
        matches: matches.map((w) => ({
          id: w.id,
          orderNumber: w.orderNumber,
          productName: w.productName,
          status: w.status,
          quantity: w.quantity,
          producedQuantity: w.producedQuantity,
          totalCost: w.totalCost,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.receipt_vouchers',
    labelAr: 'بحث عن سند قبض',
    descriptionAr: 'يبحث عن سند قبض برقم السند أو اسم العميل ويعيد معرفه (id) وحالته ومبلغه.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: searchParam('رقم سند القبض أو اسم العميل'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const cleanQuery = normalizeQuery(query);
      const res = await accountingApi.getReceiptVouchersPaginated(ctx.companyId, 1, 8, { status: undefined });
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const items = res.data.items || [];
      const matches = items
        .filter((v) =>
          v.voucherNumber.toLowerCase().includes(cleanQuery) ||
          normalizeQuery(v.customerName).includes(cleanQuery)
        )
        .slice(0, 8);
      return {
        matches: matches.map((v) => ({
          id: v.id,
          voucherNumber: v.voucherNumber,
          customerName: v.customerName,
          amount: v.amount,
          status: v.status,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.payment_vouchers',
    labelAr: 'بحث عن سند صرف',
    descriptionAr: 'يبحث عن سند صرف برقم السند أو اسم المورد ويعيد معرفه (id) وحالته ومبلغه.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: searchParam('رقم سند الصرف أو اسم المورد'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const cleanQuery = normalizeQuery(query);
      const res = await accountingApi.getPaymentVouchersPaginated(ctx.companyId, 1, 8, { status: undefined });
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const items = res.data.items || [];
      const matches = items
        .filter((v) =>
          v.voucherNumber.toLowerCase().includes(cleanQuery) ||
          normalizeQuery(v.supplierName || '').includes(cleanQuery)
        )
        .slice(0, 8);
      return {
        matches: matches.map((v) => ({
          id: v.id,
          voucherNumber: v.voucherNumber,
          supplierName: v.supplierName,
          amount: v.amount,
          status: v.status,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.tasks',
    labelAr: 'بحث عن مهمة',
    descriptionAr: 'يبحث عن مهمة بالعنوان أو اسم المسؤول ويعيد معرفها (id) وحالتها وأولويتها.',
    permission: 'crm.view',
    dangerLevel: 'read',
    parameters: searchParam('عنوان المهمة أو اسم المسؤول'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const cleanQuery = normalizeQuery(query);
      const res = await crmApi.getTasks(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const matches = res.data
        .filter((t) =>
          normalizeQuery(t.title).includes(cleanQuery) ||
          normalizeQuery(t.assignedName || '').includes(cleanQuery)
        )
        .slice(0, 8);
      return {
        matches: matches.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: t.dueDate,
          assignedName: t.assignedName,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.activities',
    labelAr: 'بحث عن نشاط',
    descriptionAr: 'يبحث عن نشاط حسب الموضوع أو النوع ويعيد معرفه (id) وتاريخه.',
    permission: 'crm.view',
    dangerLevel: 'read',
    parameters: searchParam('موضوع النشاط أو نوعه (call/meeting/email/visit/note)'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const cleanQuery = normalizeQuery(query);
      const res = await crmApi.getActivities(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const matches = res.data
        .filter((a) =>
          normalizeQuery(a.subject).includes(cleanQuery) ||
          a.type.toLowerCase().includes(cleanQuery) ||
          normalizeQuery(a.assignedName || '').includes(cleanQuery)
        )
        .slice(0, 8);
      return {
        matches: matches.map((a) => ({
          id: a.id,
          subject: a.subject,
          type: a.type,
          activityDate: a.activityDate,
          assignedName: a.assignedName,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.returns',
    labelAr: 'بحث عن مردود',
    descriptionAr: 'يبحث عن مردودات (مبيعات ومشتريات) برقم المردود أو اسم العميل/المورد ويعيد معرفها (id) ونوعها.',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: searchParam('رقم المردود أو اسم العميل أو المورد'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const cleanQuery = normalizeQuery(query);
      const [salesResult, purchaseResult] = await Promise.all([
        salesApi.getReturns(ctx.companyId),
        purchasesApi.getReturns(ctx.companyId),
      ]);
      const combined: Array<{
        id: string; returnNumber: string; entityName: string; type: 'sales' | 'purchase'; status: string; totalAmount: number;
      }> = [];
      if (salesResult.success && salesResult.data) {
        for (const r of salesResult.data) {
          const n = (r.returnNumber || '').toLowerCase();
          const c = normalizeQuery(String(r.customer ?? ''));
          if (n.includes(cleanQuery) || c.includes(cleanQuery)) {
            combined.push({ id: r.id, returnNumber: r.returnNumber || '', entityName: String(r.customer ?? ''), type: 'sales', status: r.status, totalAmount: r.totalAmount });
          }
        }
      }
      if (purchaseResult.success && purchaseResult.data) {
        for (const r of purchaseResult.data) {
          const n = (r.returnNumber || '').toLowerCase();
          const s = normalizeQuery(String(r.supplier ?? ''));
          if (n.includes(cleanQuery) || s.includes(cleanQuery)) {
            combined.push({ id: r.id, returnNumber: r.returnNumber || '', entityName: String(r.supplier ?? ''), type: 'purchase', status: r.status, totalAmount: r.totalAmount });
          }
        }
      }
      return {
        matches: combined.slice(0, 8),
        totalMatches: combined.length,
      };
    },
  },
  {
    name: 'search.journal_entries',
    labelAr: 'بحث عن قيود يومية',
    descriptionAr: 'يبحث في القيود اليومية حسب المرجع أو الوصف ويعيد معرف القيد (id) وتفاصيله.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: searchParam('رقم المرجع أو وصف القيد'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const res = await accountingApi.getTransactionsPaginated(ctx.companyId, 1, 8);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const items = res.data.items || [];
      const matches = items
        .filter((t) =>
          (t.reference || '').toLowerCase().includes(query) ||
          (t.description || '').toLowerCase().includes(query)
        )
        .slice(0, 8);
      return {
        matches: matches.map((t) => ({
          id: t.id,
          reference: t.reference,
          description: t.description,
          date: t.date,
          totalAmount: t.totalAmount,
          status: t.status,
          entryCount: t.entries?.length || 0,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.stock_movements',
    labelAr: 'بحث عن حركة مخزنية',
    descriptionAr: 'يبحث في حركات المخزون حسب اسم المنتج أو النوع ويعيد معرف الحركة (id) وكميتها.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: searchParam('اسم المنتج أو نوع الحركة (in/out/transfer)'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const res = await inventoryApi.getInventoryTransactionsPaginated(ctx.companyId, 1, 8);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const items = res.data.items || [];
      const matches = items
        .filter((m) =>
          (m.productName || '').toLowerCase().includes(query) ||
          m.type.toLowerCase().includes(query)
        )
        .slice(0, 8);
      return {
        matches: matches.map((m) => ({
          id: m.id,
          productName: m.productName,
          type: m.type,
          quantity: m.quantity,
          warehouseName: m.warehouseName,
          date: m.date,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.attendance',
    labelAr: 'بحث عن حضور',
    descriptionAr: 'يبحث في سجلات الحضور حسب اسم الموظف ويعيد معرف السجل (id) وحالة الحضور.',
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: searchParam('اسم الموظف'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const cleanQuery = normalizeQuery(query);
      const now = new Date();
      const res = await hrApi.getAttendance(ctx.companyId, now.getMonth() + 1, now.getFullYear());
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const matches = res.data
        .filter((a) =>
          normalizeQuery(a.employeeName || '').includes(cleanQuery)
        )
        .slice(0, 8);
      return {
        matches: matches.map((a) => ({
          id: a.id,
          employeeName: a.employeeName,
          date: a.date,
          status: a.status,
          checkIn: a.checkIn,
          checkOut: a.checkOut,
        })),
        totalMatches: matches.length,
      };
    },
  },
  {
    name: 'search.leaves',
    labelAr: 'بحث عن إجازة',
    descriptionAr: 'يبحث في طلبات الإجازات حسب اسم الموظف أو نوع الإجازة ويعيد معرف الطلب (id) وحالته.',
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: searchParam('اسم الموظف أو نوع الإجازة (annual/sick/emergency/unpaid)'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const cleanQuery = normalizeQuery(query);
      const res = await hrApi.getLeavesPaginated(ctx.companyId, 1, 8);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const items = res.data.items || [];
      const matches = items
        .filter((l) =>
          normalizeQuery(l.employeeName || '').includes(cleanQuery) ||
          l.leaveType.toLowerCase().includes(cleanQuery)
        )
        .slice(0, 8);
      return {
        matches: matches.map((l) => ({
          id: l.id,
          employeeName: l.employeeName,
          leaveType: l.leaveType,
          startDate: l.startDate,
          endDate: l.endDate,
          days: l.days,
          status: l.status,
        })),
        totalMatches: matches.length,
      };
    },
  },
  // ─── Settings: Document Sequences ─────────────────────────────────────────
  {
    name: 'search.document_sequences',
    labelAr: 'بحث في تتابع الأرقام',
    descriptionAr: 'يسترجع قائمة تتابعات الأرقام (Document Sequences) المسجلة في النظام (مثل تتابع فواتير المبيعات، المشتريات، السندات). معرفات التتابع مطلوبة لربط الأرقام التلقائية.',
    permission: 'settings.view',
    dangerLevel: 'read',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async (_args, ctx) => {
      const res = await settingsApi.getDocumentSequences(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب التتابعات' };
      return {
        matches: res.data.map((s) => ({
          id: s.id,
          documentType: s.documentType,
          prefix: s.prefix,
          suffix: s.suffix,
          nextNumber: s.currentNumber + (s.incrementStep || 1),
          isActive: s.isActive,
        })),
        totalMatches: res.data.length,
      };
    },
  },
  // ─── Settings: Product Types ──────────────────────────────────────────────
  {
    name: 'search.product_types',
    labelAr: 'بحث عن تصنيف منتجات',
    descriptionAr: 'يبحث في تصنيفات المنتجات (Product Types) ويعيد المعرف والاسم. استخدم هذا قبل إنشاء منتج لربطه بالتصنيف المناسب.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: searchParam('اسم التصنيف (عربي أو إنجليزي)'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      const res = await settingsApi.getProductTypes(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب التصنيفات' };
      const matches = res.data
        .filter((t) => !query || (t.nameAr || '').toLowerCase().includes(query) || (t.nameEn || '').toLowerCase().includes(query))
        .slice(0, 8);
      return {
        matches: matches.map((t) => ({ id: t.id, nameAr: t.nameAr, nameEn: t.nameEn, code: t.code, isActive: t.isActive })),
        totalMatches: matches.length,
      };
    },
  },
  // ─── Settings: Units ──────────────────────────────────────────────────────
  {
    name: 'search.units',
    labelAr: 'بحث عن وحدة قياس',
    descriptionAr: 'يبحث في وحدات القياس (Units) ويعيد المعرف والاسم. استخدم قبل إنشاء منتج لاختيار الوحدة المناسبة.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: searchParam('اسم الوحدة (عربي أو إنجليزي)'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      const res = await settingsApi.getUnits(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب الوحدات' };
      const matches = res.data
        .filter((u) => !query || (u.nameAr || '').toLowerCase().includes(query) || (u.nameEn || '').toLowerCase().includes(query))
        .slice(0, 8);
      return {
        matches: matches.map((u) => ({ id: u.id, nameAr: u.nameAr, nameEn: u.nameEn, code: u.code, conversionFactor: u.conversionFactor, isActive: u.isActive })),
        totalMatches: matches.length,
      };
    },
  },
  // ─── Settings: Cash Boxes ─────────────────────────────────────────────────
  {
    name: 'search.cash_boxes',
    labelAr: 'بحث عن خزنة/صندوق',
    descriptionAr: 'يبحث في الخزائن والصناديق النقدية ويعيد المعرف والرصيد. استخدم قبل إنشاء سند قبض/صرف نقدي.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: searchParam('اسم الخزنة'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      const res = await settingsApi.getCashBoxes(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب الخزائن' };
      const matches = res.data
        .filter((b) => !query || (b.name || '').toLowerCase().includes(query))
        .slice(0, 8);
      return {
        matches: matches.map((b) => ({ id: b.id, name: b.name, code: b.code, currentBalance: b.currentBalance, isActive: b.isActive })),
        totalMatches: matches.length,
      };
    },
  },
  // ─── Settings: Banks ──────────────────────────────────────────────────────
  {
    name: 'search.banks',
    labelAr: 'بحث عن بنك',
    descriptionAr: 'يبحث في الحسابات البنكية ويعيد المعرف والرصيد. استخدم قبل إنشاء سند قبض/صرف بنكي.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: searchParam('اسم الحساب البنكي أو اسم البنك'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      const res = await settingsApi.getBanks(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب البنوك' };
      const matches = res.data
        .filter((b) => !query || (b.name || '').toLowerCase().includes(query) || (b.bankName || '').toLowerCase().includes(query))
        .slice(0, 8);
      return {
        matches: matches.map((b) => ({ id: b.id, name: b.name, bankName: b.bankName, accountNumber: b.accountNumber, currentBalance: b.currentBalance, isActive: b.isActive })),
        totalMatches: matches.length,
      };
    },
  },
  // ─── Settings: Cost Centers ───────────────────────────────────────────────
  {
    name: 'search.cost_centers',
    labelAr: 'بحث عن مركز تكلفة',
    descriptionAr: 'يبحث في مراكز التكلفة ويعيد المعرف والاسم. استخدم قبل إنشاء قيد محاسبي لربطه بمركز التكلفة.',
    permission: 'accounting.view',
    dangerLevel: 'read',
    parameters: searchParam('اسم مركز التكلفة (عربي أو إنجليزي)'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      const res = await settingsApi.getCostCenters(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب مراكز التكلفة' };
      const matches = res.data
        .filter((c) => !query || (c.nameAr || '').toLowerCase().includes(query) || (c.nameEn || '').toLowerCase().includes(query))
        .slice(0, 8);
      return {
        matches: matches.map((c) => ({ id: c.id, nameAr: c.nameAr, nameEn: c.nameEn, code: c.code, type: c.type, isActive: c.isActive })),
        totalMatches: matches.length,
      };
    },
  },
  // ─── HR: Payroll Runs ────────────────────────────────────────────────────
  {
    name: 'search.payroll_runs',
    labelAr: 'بحث في مسيرات الرواتب',
    descriptionAr: 'يبحث في مسيرات الرواتب ويعيد معرف المسير (id) وحالته وشهره وسنته.',
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: searchParam('شهر (1-12) أو سنة أو الحالة (draft/posted)'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const res = await hrApi.getPayrollRunsPaginated(ctx.companyId, 1, 20);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const items = res.data.items || [];
      const matches = items
        .filter((r) =>
          String(r.month).includes(query) ||
          String(r.year).includes(query) ||
          r.status.toLowerCase().includes(query)
        )
        .slice(0, 8);
      const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
      return {
        matches: matches.map((r) => ({
          id: r.id,
          title: `${monthNames[(r.month - 1) % 12] || r.month} ${r.year}`,
          month: r.month,
          year: r.year,
          totalAmount: r.totalAmount,
          status: r.status,
        })),
        totalMatches: matches.length,
      };
    },
  },
  // ─── HR: End of Service ──────────────────────────────────────────────────
  {
    name: 'search.end_of_services',
    labelAr: 'بحث في نهاية الخدمة',
    descriptionAr: 'يبحث في حسابات نهاية الخدمة ويعيد معرف الحساب (id) وحالته واسم الموظف.',
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: searchParam('اسم الموظف أو الحالة (draft/approved/paid)'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const cleanQuery = normalizeQuery(query);
      const res = await hrApi.getEndOfServicesPaginated(ctx.companyId, 1, 20);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const items = res.data.items || [];
      const matches = items
        .filter((e) =>
          normalizeQuery(e.employeeName || '').includes(cleanQuery) ||
          e.status.toLowerCase().includes(cleanQuery)
        )
        .slice(0, 8);
      return {
        matches: matches.map((e) => ({
          id: e.id,
          employeeName: e.employeeName,
          terminationDate: e.terminationDate,
          serviceYears: e.serviceYears,
          eosAmount: e.eosAmount,
          status: e.status,
        })),
        totalMatches: matches.length,
      };
    },
  },
  // ─── Inventory: Stock Adjustments ─────────────────────────────────────────
  {
    name: 'search.stock_adjustments',
    labelAr: 'بحث في تسويات المخزون',
    descriptionAr: 'يبحث في تسويات المخزون ويعيد معرف التسوية (id) والمنتج والمستودع والفرق والحالة.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: searchParam('اسم المنتج أو المستودع أو الحالة (draft/approved/posted)'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const cleanQuery = normalizeQuery(query);
      const res = await inventoryApi.getStockAdjustments(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const matches = res.data
        .filter((a) =>
          normalizeQuery(a.productName || '').includes(cleanQuery) ||
          normalizeQuery(a.warehouseName || '').includes(cleanQuery) ||
          a.status.toLowerCase().includes(cleanQuery)
        )
        .slice(0, 8);
      return {
        matches: matches.map((a) => ({
          id: a.id,
          title: a.productName,
          date: a.date,
          systemQty: a.systemQty,
          actualQty: a.actualQty,
          difference: a.difference,
          status: a.status,
        })),
        totalMatches: matches.length,
      };
    },
  },
  // ─── Inventory: Stock Transfers ───────────────────────────────────────────
  {
    name: 'search.stock_transfers',
    labelAr: 'بحث في التحويلات المخزنية',
    descriptionAr: 'يبحث في تحويلات المخازن ويعيد معرف التحويل (id) والمستودع المصدر والهدف والحالة.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: searchParam('المستودع المصدر أو الهدف أو الحالة (draft/approved/posted)'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const cleanQuery = normalizeQuery(query);
      const res = await inventoryApi.getStockTransfers(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const matches = res.data
        .filter((t) =>
          normalizeQuery(t.fromWarehouseName || '').includes(cleanQuery) ||
          normalizeQuery(t.toWarehouseName || '').includes(cleanQuery) ||
          t.status.toLowerCase().includes(cleanQuery)
        )
        .slice(0, 8);
      return {
        matches: matches.map((t) => ({
          id: t.id,
          title: `${t.fromWarehouseName || '?'} ← ${t.toWarehouseName || '?'}`,
          reference: t.reference,
          totalQuantity: t.totalQuantity,
          date: t.date,
          status: t.status,
        })),
        totalMatches: matches.length,
      };
    },
  },
  // ─── Inventory: Product Categories ────────────────────────────────────────
  {
    name: 'search.categories',
    labelAr: 'بحث في تصنيفات المنتجات',
    descriptionAr: 'يبحث في تصنيفات المنتجات ويعيد معرف التصنيف (id) واسمه.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: searchParam('اسم التصنيف'),
    execute: async (args, ctx) => {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return { error: 'نص البحث مطلوب' };
      const cleanQuery = normalizeQuery(query);
      const res = await inventoryApi.getCategories(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل البحث' };
      const matches = res.data
        .filter((c) =>
          normalizeQuery(c.name).includes(cleanQuery)
        )
        .slice(0, 8);
      return {
        matches: matches.map((c) => ({
          id: c.id,
          title: c.name,
          parentId: c.parentId,
        })),
        totalMatches: matches.length,
      };
    },
  },
];

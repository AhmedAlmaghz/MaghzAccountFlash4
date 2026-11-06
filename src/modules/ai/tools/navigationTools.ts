import type { ToolDefinition } from '../types';
import type { Permission } from '@/modules/auth/types';
import { useAuthStore } from '@/modules/auth/store';
import { navigateTo } from '../engine/navigationBridge';
import { getVisibleTools } from './registry';
import { normalizeArabic, fuzzyMatchScore } from '@/core/utils/normalizeArabic';

/**
 * Navigation tools — the assistant can open any page in the app for the user.
 * The catalog is permission-filtered so the LLM only sees accessible pages.
 */

interface PageEntry {
  key: string;
  labelAr: string;
  path: string;
  permission: Permission;
}

export const PAGE_CATALOG: PageEntry[] = [
  { key: 'dashboard', labelAr: 'لوحة التحكم', path: '/', permission: 'core.view' },
  // Accounting
  { key: 'accounting.chart', labelAr: 'شجرة الحسابات', path: '/accounting/chart', permission: 'accounting.view' },
  { key: 'accounting.journal', labelAr: 'القيود اليومية', path: '/accounting/journal', permission: 'accounting.view' },
  { key: 'accounting.trial', labelAr: 'ميزان المراجعة', path: '/accounting/trial', permission: 'accounting.view' },
  { key: 'accounting.balance', labelAr: 'الميزانية العمومية', path: '/accounting/balance', permission: 'accounting.view' },
  { key: 'accounting.profit', labelAr: 'قائمة الدخل', path: '/accounting/profit', permission: 'accounting.view' },
  { key: 'accounting.cashflow', labelAr: 'التدفقات النقدية', path: '/accounting/cashflow', permission: 'accounting.view' },
  { key: 'accounting.receipt_vouchers', labelAr: 'سندات القبض', path: '/accounting/receipt-vouchers', permission: 'accounting.view' },
  { key: 'accounting.payment_vouchers', labelAr: 'سندات الصرف', path: '/accounting/payment-vouchers', permission: 'accounting.view' },
  { key: 'accounting.ledger', labelAr: 'دفتر الأستاذ', path: '/accounting/ledger', permission: 'accounting.view' },
  { key: 'accounting.fixed_assets', labelAr: 'الأصول الثابتة', path: '/accounting/fixed-assets', permission: 'accounting.view' },
  { key: 'accounting.year_end', labelAr: 'الإقفال السنوي', path: '/accounting/year-end', permission: 'accounting.view' },
  // Inventory
  { key: 'inventory.products', labelAr: 'المنتجات', path: '/inventory/products', permission: 'inventory.view' },
  { key: 'inventory.warehouses', labelAr: 'المستودعات', path: '/inventory/warehouses', permission: 'inventory.view' },
  { key: 'inventory.stock', labelAr: 'المخزون', path: '/inventory/stock', permission: 'inventory.view' },
  { key: 'inventory.transactions', labelAr: 'الحركات المخزنية', path: '/inventory/transactions', permission: 'inventory.view' },
  { key: 'inventory.adjustments', labelAr: 'التسويات', path: '/inventory/adjustments', permission: 'inventory.view' },
  // Sales
  { key: 'sales.invoices', labelAr: 'فواتير المبيعات', path: '/sales/invoices', permission: 'sales.view' },
  { key: 'sales.customers', labelAr: 'العملاء', path: '/sales/customers', permission: 'sales.view' },
  { key: 'sales.quotations', labelAr: 'عروض الأسعار', path: '/sales/quotations', permission: 'sales.view' },
  { key: 'sales.returns', labelAr: 'مردودات المبيعات', path: '/sales/returns', permission: 'sales.view' },
  // Purchases
  { key: 'purchases.invoices', labelAr: 'فواتير المشتريات', path: '/purchases/invoices', permission: 'purchases.view' },
  { key: 'purchases.suppliers', labelAr: 'الموردين', path: '/purchases/suppliers', permission: 'purchases.view' },
  { key: 'purchases.orders', labelAr: 'أوامر الشراء', path: '/purchases/orders', permission: 'purchases.view' },
  { key: 'purchases.returns', labelAr: 'مردودات المشتريات', path: '/purchases/returns', permission: 'purchases.view' },
  // POS
  { key: 'pos.terminal', labelAr: 'نقطة البيع', path: '/pos', permission: 'pos.view' },
  { key: 'pos.shifts', labelAr: 'ورديات نقطة البيع', path: '/pos/shifts', permission: 'pos.view' },
  { key: 'pos.reports', labelAr: 'تقارير نقطة البيع', path: '/pos/reports', permission: 'pos.view' },
  { key: 'pos.settings', labelAr: 'إعدادات نقطة البيع', path: '/pos/settings', permission: 'pos.view' },
  // Manufacturing
  { key: 'manufacturing.bom', labelAr: 'فواتير المواد', path: '/manufacturing/bom', permission: 'manufacturing.view' },
  { key: 'manufacturing.work_orders', labelAr: 'أوامر التشغيل', path: '/manufacturing/work-orders', permission: 'manufacturing.view' },
  { key: 'manufacturing.cost_report', labelAr: 'تحليل التكاليف', path: '/manufacturing/cost-report', permission: 'manufacturing.view' },
  { key: 'manufacturing.variance_report', labelAr: 'تحليل الانحرافات', path: '/manufacturing/variance-report', permission: 'manufacturing.view' },
  // HR
  { key: 'hr.employees', labelAr: 'الموظفين', path: '/hr/employees', permission: 'hr.view' },
  { key: 'hr.departments', labelAr: 'الأقسام', path: '/hr/departments', permission: 'hr.view' },
  { key: 'hr.attendance', labelAr: 'الحضور', path: '/hr/attendance', permission: 'hr.view' },
  { key: 'hr.payroll', labelAr: 'الرواتب', path: '/hr/payroll', permission: 'hr.view' },
  { key: 'hr.leaves', labelAr: 'الإجازات', path: '/hr/leaves', permission: 'hr.view' },
  { key: 'hr.end_of_service', labelAr: 'نهاية الخدمة', path: '/hr/end-of-service', permission: 'hr.view' },
  // CRM
  { key: 'crm.leads', labelAr: 'العملاء المحتملين', path: '/crm/leads', permission: 'crm.view' },
  { key: 'crm.opportunities', labelAr: 'الفرص', path: '/crm/opportunities', permission: 'crm.view' },
  { key: 'crm.tasks', labelAr: 'المهام', path: '/crm/tasks', permission: 'crm.view' },
  { key: 'crm.activities', labelAr: 'النشاطات', path: '/crm/activities', permission: 'crm.view' },
  // Reports
  { key: 'reports.hub', labelAr: 'مركز التقارير', path: '/reports', permission: 'reports.view' },
  { key: 'reports.sales_analysis', labelAr: 'تحليل المبيعات', path: '/reports/sales-analysis', permission: 'reports.view' },
  { key: 'reports.inventory_analysis', labelAr: 'تحليل المخزون', path: '/reports/inventory-analysis', permission: 'reports.view' },
  { key: 'reports.low_stock', labelAr: 'تنبيه المخزون', path: '/reports/low-stock-alert', permission: 'reports.view' },
  { key: 'reports.stock_movement', labelAr: 'حركة المخزون', path: '/reports/stock-movement', permission: 'reports.view' },
  { key: 'reports.stock_valuation', labelAr: 'تقييم المخزون', path: '/reports/stock-valuation', permission: 'reports.view' },
  { key: 'reports.profit_analysis', labelAr: 'تحليل الأرباح', path: '/reports/profit-analysis', permission: 'reports.view' },
  { key: 'reports.customer_statement', labelAr: 'كشف حساب عميل', path: '/reports/customer-statement', permission: 'reports.view' },
  { key: 'reports.supplier_statement', labelAr: 'كشف حساب مورد', path: '/reports/supplier-statement', permission: 'reports.view' },
  { key: 'reports.custom_builder', labelAr: 'تقرير مخصص', path: '/reports/custom-builder', permission: 'reports.view' },
  { key: 'reports.lead_conversion', labelAr: 'تحويل العملاء', path: '/reports/lead-conversion', permission: 'reports.view' },
  { key: 'reports.opportunity_pipeline', labelAr: 'خط الفرص', path: '/reports/opportunity-pipeline', permission: 'reports.view' },
  // Settings
  { key: 'settings.company', labelAr: 'بيانات الشركة', path: '/settings/company', permission: 'settings.view' },
  { key: 'settings.themes', labelAr: 'الثيمات', path: '/settings/themes', permission: 'settings.view' },
  { key: 'settings.currencies', labelAr: 'العملات', path: '/settings/currencies', permission: 'settings.view' },
  { key: 'settings.vat', labelAr: 'الضريبة', path: '/settings/vat', permission: 'settings.view' },
  { key: 'settings.hr_policies', labelAr: 'سياسات الموارد البشرية', path: '/settings/hr-policies', permission: 'settings.view' },
  { key: 'settings.payroll_components', labelAr: 'مكونات الرواتب', path: '/settings/payroll-components', permission: 'settings.view' },
  { key: 'settings.branches', labelAr: 'الفروع', path: '/settings/branches', permission: 'settings.view' },
  { key: 'settings.backup', labelAr: 'النسخ الاحتياطي', path: '/settings/backup', permission: 'settings.view' },
  { key: 'settings.document_sequences', labelAr: 'التسلسلات', path: '/settings/document-sequences', permission: 'settings.view' },
  { key: 'settings.product_types', labelAr: 'أنواع المنتجات', path: '/settings/product-types', permission: 'settings.view' },
  { key: 'settings.product_categories', labelAr: 'تصنيفات المنتجات', path: '/settings/product-categories', permission: 'settings.view' },
  { key: 'settings.default_accounts', labelAr: 'الحسابات الافتراضية', path: '/settings/default-accounts', permission: 'settings.view' },
  { key: 'settings.units', labelAr: 'الوحدات', path: '/settings/units', permission: 'settings.view' },
  { key: 'settings.cash_boxes', labelAr: 'النقدية والخزائن', path: '/settings/cash-boxes', permission: 'settings.view' },
  { key: 'settings.cost_centers', labelAr: 'مراكز التكلفة', path: '/settings/cost-centers', permission: 'settings.view' },
  { key: 'settings.database', labelAr: 'قاعدة البيانات', path: '/settings/database', permission: 'settings.view' },
  { key: 'settings.users', labelAr: 'المستخدمين', path: '/users', permission: 'settings.view' },
  { key: 'settings.roles', labelAr: 'الأدوار', path: '/roles', permission: 'settings.view' },
  // P2 fix: the route guard requires ai.settings (not settings.view) — the
  // old entry let the agent "successfully" navigate a settings.view-only
  // user into a guard bounce back to /. Match the route.
  { key: 'settings.ai', labelAr: 'إعدادات الذكاء الاصطناعي', path: '/settings/ai', permission: 'ai.settings' },
];

function accessiblePages(): PageEntry[] {
  const { hasPermission } = useAuthStore.getState();
  return PAGE_CATALOG.filter((p) => hasPermission(p.permission));
}

export const navigationTools: ToolDefinition[] = [
  {
    name: 'app.list_pages',
    labelAr: 'قائمة الصفحات',
    descriptionAr: 'يعرض قائمة الصفحات المتاحة في النظام مع مفاتيحها. استخدمه لمعرفة مفتاح الصفحة قبل الانتقال إليها.',
    permission: 'core.view',
    dangerLevel: 'read',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({
      pages: accessiblePages().map((p) => ({ key: p.key, name: p.labelAr })),
    }),
  },
  {
    name: 'app.navigate',
    labelAr: 'الانتقال إلى صفحة',
    descriptionAr: 'يفتح صفحة محددة في التطبيق للمستخدم. استخدم مفتاح الصفحة (key) من أداة app.list_pages. مثال: للانتقال لفواتير المبيعات استخدم sales.invoices',
    permission: 'core.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        page: { type: 'string', description: 'مفتاح الصفحة (key) من app.list_pages' },
      },
      required: ['page'],
    },
    execute: async (args) => {
      const key = String(args.page || '').trim();
      const page = accessiblePages().find((p) => p.key === key);
      if (!page) {
        return { error: `صفحة غير موجودة أو غير مصرح بها: ${key}. استخدم app.list_pages لرؤية المفاتيح المتاحة.` };
      }
      const navigated = navigateTo(page.path);
      if (!navigated) return { error: 'التنقل غير متاح حالياً' };
      return { navigated: true, page: page.labelAr, path: page.path };
    },
  },
  {
    name: 'app.find_tools',
    labelAr: 'البحث عن أداة',
    descriptionAr:
      'يبحث في كل أدوات النظام المتاحة للمستخدم (بالمعنى العربي مثل "راتب" أو "تسوية مخزون"، أو بالاسم الإنجليزي مثل payroll / create_bom) ويعيد أفضل الأدوات مع مخطط معاملاتها الكامل. ' +
      'استخدمه عندما لا تجد الأداة التي تحتاجها في قائمتك المعلنة، أو عند الشك في اسم أداة — ثم استدعِ الأداة الناتجة باسمها مباشرة في دورك التالي. ' +
      'لبحث الكيانات (عميل/مورد/منتج/حساب) استخدم ai.resolve_entities، وللصفحات app.list_pages.',
    permission: 'core.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'كلمة أو عبارة البحث (مثال: "إجازة"، "تسوية مخزون"، "payroll")' },
        limit: { type: 'number', description: 'عدد النتائج (افتراضي 5، أقصى 10)' },
      },
      required: ['query'],
    },
    execute: async (args) => {
      const query = String(args.query ?? '').trim();
      const rawLimit = Number(args.limit);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 10) : 5;
      // RBAC: discovery only ever looks at tools this user may execute —
      // same filter the router applies. Never widens the surface.
      const visible = getVisibleTools().filter((t) => t.name !== 'app.find_tools');

      if (!query) {
        const domains = new Map<string, number>();
        for (const t of visible) {
          const domain = t.name.split('.')[0] || t.name;
          domains.set(domain, (domains.get(domain) ?? 0) + 1);
        }
        return {
          visibleCount: visible.length,
          domains: [...domains.entries()]
            .map(([domain, count]) => ({ domain, count }))
            .sort((a, b) => b.count - a.count),
          hint: 'مرّر كلمة مفتاحية في query (مثل: راتب، إجازة، فاتورة شراء، تسوية مخزون، payroll) للعثور على الأداة المناسبة.',
        };
      }

      const scored = visible
        .map((t) => ({ tool: t, score: scoreToolForQuery(query, t) }))
        .sort((a, b) => b.score - a.score);
      const matches = scored.filter((s) => s.score >= 0.35).slice(0, limit);

      if (matches.length === 0) {
        // Near misses beat a dead end: the model sees the closest real names
        // and can broaden its keyword or conclude honestly.
        return {
          query,
          found: 0,
          visibleCount: visible.length,
          matches: [],
          nearMisses: scored
            .filter((s) => s.score > 0)
            .slice(0, 3)
            .map((s) => ({ name: s.tool.name, labelAr: s.tool.labelAr })),
          hint: 'لا توجد أداة مطابقة — جرّب كلمة أعم (مثل "فاتورة" بدل "فاتورة يوليو"), أو app.list_pages لصفحات النظام.',
        };
      }

      return {
        query,
        found: matches.length,
        visibleCount: visible.length,
        matches: matches.map(({ tool: t, score }) => ({
          name: t.name,
          labelAr: t.labelAr,
          dangerLevel: t.dangerLevel,
          descriptionAr: t.descriptionAr,
          parameters: t.parameters,
          score: Math.round(score * 100) / 100,
        })),
        toolNames: matches.map(({ tool: t }) => t.name),
        note: 'الأدوات أعلاه أصبحت ضمن أدواتك المعلنة في الدورة التالية — استدعِ الأداة باسمها ومعاملاتها مباشرة.',
      };
    },
  },
];

/** Arabic definite-article strip for token comparison ("الرواتب" ↔ "راتب"). */
function stripDefiniteArticle(token: string): string {
  return token.length > 3 && token.startsWith('ال') ? token.slice(2) : token;
}

/**
 * Score one tool against a free-text query (0–1).
 *
 * Signals, strongest first: exact name/label, name substring, whole query
 * token equal to a name segment (`hr.get_payroll_runs` ↔ "payroll"), label
 * substring, then token-vs-token fuzzy similarity. Whole-field Levenshtein
 * drowns short Arabic tokens in long labels ("راتب" vs "مسير الرواتب"), so
 * tokens are ALSO compared pairwise — both sides stripped of the definite
 * article, since "الرواتب" never substring-matches "راتب".
 */
export function scoreToolForQuery(
  rawQuery: string,
  tool: Pick<ToolDefinition, 'name' | 'labelAr' | 'descriptionAr'>,
): number {
  const q = normalizeArabic(rawQuery);
  if (!q) return 0;
  const name = normalizeArabic(tool.name);
  const label = normalizeArabic(tool.labelAr);
  const desc = normalizeArabic(tool.descriptionAr);

  if (name === q || label === q) return 1;

  const tokens = [...new Set(q.split(/\s+/).filter(Boolean))];
  const nameSegments = name.split(/[._\s]+/).filter(Boolean);

  let best = 0;
  if (name.includes(q)) best = Math.max(best, 0.95);
  if (tokens.some((t) => t.length >= 3 && nameSegments.includes(t))) best = Math.max(best, 0.9);
  if (label.includes(q)) best = Math.max(best, 0.85);

  for (const field of [label, name, desc]) {
    best = Math.max(best, fuzzyMatchScore(q, field));
  }

  const fieldTokens = new Set<string>();
  for (const field of [label, desc]) {
    for (const t of field.split(/\s+/)) {
      fieldTokens.add(t);
      fieldTokens.add(stripDefiniteArticle(t));
    }
  }
  for (const t of nameSegments) {
    fieldTokens.add(t);
    fieldTokens.add(stripDefiniteArticle(t));
  }
  for (const rawToken of tokens) {
    const token = stripDefiniteArticle(rawToken);
    if (token.length < 3) continue;
    for (const fieldToken of fieldTokens) {
      if (fieldToken.length < 3) continue;
      const s = fuzzyMatchScore(token, fieldToken);
      if (s > best) best = s;
    }
  }
  return best;
}

/**
 * Names of the tools an `app.find_tools` result discovered — the engine
 * feeds them into adaptive expansion so they are advertised next cycle.
 * Pure + defensive: any shape producing no string names yields [].
 */
export function discoveredToolNamesFromResult(result: unknown): string[] {
  const names = (result as { toolNames?: unknown } | null | undefined)?.toolNames;
  if (!Array.isArray(names)) return [];
  return names.filter((n): n is string => typeof n === 'string' && n.length > 0);
}

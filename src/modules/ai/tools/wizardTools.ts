import type { ToolDefinition } from '../types';
import { salesApi } from '@/modules/sales/api';
import { purchasesApi } from '@/modules/purchases/api';
import { crmApi } from '@/modules/crm/api';
import { inventoryApi } from '@/modules/inventory/api';
import { getNextDocumentNumber } from '@/core/api';
import { coreApi } from '@/modules/core/api';

// ─── Helpers (mirror writeTools.ts) ───────────────────────────────────────

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

async function getVatRate(companyId: string): Promise<number> {
  const res = await coreApi.getVatSettings(companyId);
  const rate = res.success && res.data ? num(res.data.vatRate) : 0;
  return rate > 0 ? rate : 15;
}

interface RawLine {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
}

function parseLines(raw: unknown): RawLine[] | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'يجب تمرير صنف واحد على الأقل في lines' };
  const lines: RawLine[] = [];
  for (const item of raw) {
    const productId = str((item as Record<string, unknown>).productId);
    const quantity = num((item as Record<string, unknown>).quantity);
    const unitPrice = num((item as Record<string, unknown>).unitPrice);
    const discountPercent = num((item as Record<string, unknown>).discountPercent);
    if (!productId) return { error: 'كل صنف يحتاج productId — استخدم search.products لإيجاد المنتج' };
    if (quantity <= 0) return { error: 'الكمية يجب أن تكون أكبر من صفر' };
    if (unitPrice < 0) return { error: 'السعر لا يمكن أن يكون سالباً' };
    lines.push({ productId, quantity, unitPrice, discountPercent });
  }
  return lines;
}

const LINES_SCHEMA = {
  type: 'array',
  description: 'أصناف الفاتورة. احصل على productId وسعر البيع من search.products',
  items: {
    type: 'object',
    properties: {
      productId: { type: 'string', description: 'معرف المنتج (من search.products)' },
      quantity: { type: 'number', description: 'الكمية' },
      unitPrice: { type: 'number', description: 'سعر الوحدة' },
      discountPercent: { type: 'number', description: 'نسبة الخصم 0-100 (اختياري)' },
    },
    required: ['productId', 'quantity', 'unitPrice'],
  },
};

/**
 * Multi-step wizard tools.
 *
 * Each wizard chains multiple atomic API calls into a single confirmation step.
 * On failure mid-chain, earlier steps are rolled back if possible.
 */

export const wizardTools: ToolDefinition[] = [
  // ─── Sales: Create + Post Invoice ─────────────────────────────────────
  {
    name: 'sales.create_and_post_invoice',
    labelAr: 'إنشاء وترحيل فاتورة مبيعات',
    descriptionAr: 'ينشئ فاتورة مبيعات ويرحّلها فوراً (مسودة ← مرحّلة) في خطوة واحدة. الإجمالي والضريبة يُحتسبان تلقائياً. استخدم search.customers و search.products أولاً.',
    permission: 'sales.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'معرف العميل (من search.customers)' },
        dueDate: { type: 'string', description: 'تاريخ الاستحقاق YYYY-MM-DD (اختياري)' },
        notes: { type: 'string' },
        lines: LINES_SCHEMA,
      },
      required: ['customerId', 'lines'],
    },
    summarizeArgs: (a) => {
      const count = Array.isArray(a.lines) ? a.lines.length : 0;
      return `إنشاء وترحيل فاتورة مبيعات بعدد أصناف: ${count}`;
    },
    execute: async (args, ctx) => {
      const customerId = str(args.customerId);
      if (!customerId) return { error: 'customerId مطلوب — استخدم search.customers أولاً' };
      const parsed = parseLines(args.lines);
      if ('error' in parsed) return { error: parsed.error };

      const vatRate = await getVatRate(ctx.companyId);
      const docNumber = await getNextDocumentNumber(ctx.companyId, 'sales_invoice');
      if (!docNumber.success || !docNumber.number) return { error: docNumber.error || 'فشل توليد رقم الفاتورة' };

      const lines = parsed.map((l) => {
        const lineTotal = round2(l.quantity * l.unitPrice * (1 - l.discountPercent / 100));
        return { ...l, vatPercent: vatRate, lineTotal };
      });
      const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
      const vatAmount = round2(lines.reduce((s, l) => s + (l.lineTotal * l.vatPercent) / 100, 0));
      const totalAmount = round2(subtotal + vatAmount);

      // Step 1: Create draft invoice
      const createRes = await salesApi.createInvoice({
        companyId: ctx.companyId,
        invoiceNumber: docNumber.number,
        customerId,
        date: today(),
        dueDate: str(args.dueDate),
        subtotal,
        discountAmount: 0,
        vatAmount,
        totalAmount,
        paidAmount: 0,
        status: 'draft',
        notes: str(args.notes),
        lines,
      });
      if (!createRes.success) return { error: createRes.error || 'فشل إنشاء الفاتورة' };
      const invoiceId = createRes.id;
      if (!invoiceId) return { error: 'تم إنشاء الفاتورة لكن لم يُرجع معرف' };

      // Step 2: Post the invoice
      const postRes = await salesApi.postInvoice(invoiceId, ctx.companyId);
      if (!postRes.success) {
        // Rollback: delete the draft invoice
        await salesApi.deleteInvoice(invoiceId, ctx.companyId);
        return { error: `تم إنشاء الفاتورة لكن فشل الترحيل: ${postRes.error}. تم التراجع عن الإنشاء.` };
      }

      return {
        success: true,
        invoiceId,
        invoiceNumber: docNumber.number,
        status: 'posted',
        subtotal,
        vatAmount,
        totalAmount,
      };
    },
  },

  // ─── CRM: Convert Lead → Customer ──────────────────────────────────────
  {
    name: 'purchases.create_and_post_invoice',
    labelAr: 'إنشاء وترحيل فاتورة مشتريات',
    descriptionAr: 'ينشئ فاتورة مشتريات ويرحّلها فوراً (مسودة ← مرحّلة) في خطوة واحدة. الإجمالي والضريبة يُحتسبان تلقائياً. استخدم search.suppliers و search.products أولاً.',
    permission: 'purchases.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        supplierId: { type: 'string', description: 'معرف المورد (من search.suppliers)' },
        dueDate: { type: 'string', description: 'تاريخ الاستحقاق YYYY-MM-DD (اختياري)' },
        notes: { type: 'string' },
        lines: LINES_SCHEMA,
      },
      required: ['supplierId', 'lines'],
    },
    summarizeArgs: (a) => {
      const count = Array.isArray(a.lines) ? a.lines.length : 0;
      return `إنشاء وترحيل فاتورة مشتريات بعدد أصناف: ${count}`;
    },
    execute: async (args, ctx) => {
      const supplierId = str(args.supplierId);
      if (!supplierId) return { error: 'supplierId مطلوب — استخدم search.suppliers أولاً' };
      const parsed = parseLines(args.lines);
      if ('error' in parsed) return { error: parsed.error };

      const vatRate = await getVatRate(ctx.companyId);
      const docNumber = await getNextDocumentNumber(ctx.companyId, 'purchase_invoice');
      if (!docNumber.success || !docNumber.number) return { error: docNumber.error || 'فشل توليد رقم الفاتورة' };

      const lines = parsed.map((l) => {
        const lineTotal = round2(l.quantity * l.unitPrice * (1 - l.discountPercent / 100));
        return { ...l, vatPercent: vatRate, lineTotal };
      });
      const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
      const vatAmount = round2(lines.reduce((s, l) => s + (l.lineTotal * l.vatPercent) / 100, 0));
      const totalAmount = round2(subtotal + vatAmount);

      // Step 1: Create draft invoice
      const createRes = await purchasesApi.createInvoice({
        companyId: ctx.companyId,
        invoiceNumber: docNumber.number,
        supplierId,
        date: today(),
        dueDate: str(args.dueDate),
        subtotal,
        discountAmount: 0,
        vatAmount,
        totalAmount,
        paidAmount: 0,
        status: 'draft',
        notes: str(args.notes),
        lines,
      });
      if (!createRes.success) return { error: createRes.error || 'فشل إنشاء الفاتورة' };
      const invoiceId = createRes.id;
      if (!invoiceId) return { error: 'تم إنشاء الفاتورة لكن لم يُرجع معرف' };

      // Step 2: Post the invoice
      const postRes = await purchasesApi.postInvoice(invoiceId, ctx.companyId);
      if (!postRes.success) {
        await purchasesApi.deleteInvoice(invoiceId, ctx.companyId);
        return { error: `تم إنشاء الفاتورة لكن فشل الترحيل: ${postRes.error}. تم التراجع عن الإنشاء.` };
      }

      return {
        success: true,
        invoiceId,
        invoiceNumber: docNumber.number,
        status: 'posted',
        subtotal,
        vatAmount,
        totalAmount,
      };
    },
  },

  // ─── CRM: Convert Lead → Customer ──────────────────────────────────────
  {
    name: 'crm.convert_lead_to_customer',
    labelAr: 'تحويل عميل محتمل إلى عميل',
    descriptionAr: 'يحوّل عميلاً محتملاً (lead) إلى عميل (customer) مع كامل بياناته، ويحدّث حالة العميل المحتمل إلى "تم التحويل". استخدم search.leads أولاً للحصول على معرف العميل المحتمل.',
    permission: 'crm.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        leadId: { type: 'string', description: 'معرف العميل المحتمل (من search.leads)' },
        address: { type: 'string', description: 'العنوان (اختياري — يُستخدم من بيانات الـ lead إن تُرك)' },
        taxNumber: { type: 'string', description: 'الرقم الضريبي (اختياري)' },
        creditLimit: { type: 'number', description: 'حد الائتمان (اختياري، افتراضي 0)' },
      },
      required: ['leadId'],
    },
    summarizeArgs: (a) => `تحويل عميل محتمل إلى عميل (المعرف: ${String(a.leadId).slice(0, 8)}…)`,
    execute: async (args, ctx) => {
      const leadId = str(args.leadId);
      if (!leadId) return { error: 'leadId مطلوب — استخدم search.leads أولاً' };

      const codeSeq = await getNextDocumentNumber(ctx.companyId, 'customer');
      if (!codeSeq.success || !codeSeq.number) return { error: codeSeq.error || 'فشل توليد رقم العميل' };

      const res = await crmApi.convertLeadToCustomer(leadId, ctx.companyId, {
        code: codeSeq.number,
        address: str(args.address) || '',
        taxNumber: str(args.taxNumber) || '',
        creditLimit: num(args.creditLimit),
      });
      if (!res.success) return { error: res.error || 'فشل تحويل العميل المحتمل' };

      return {
        success: true,
        customerId: res.id,
        message: 'تم تحويل العميل المحتمل إلى عميل بنجاح',
      };
    },
  },

  // ─── Inventory: Transfer Stock between warehouses ───────────────────────
  {
    name: 'inventory.transfer_stock',
    labelAr: 'تحويل مخزون بين مستودعين',
    descriptionAr: 'ينقل كمية محددة من منتج من مستودع إلى آخر. ينقص من المصدر ويزيد في الوجهة. استخدم search.products و search.warehouses أولاً.',
    permission: 'inventory.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'معرف المنتج (من search.products)' },
        fromWarehouseId: { type: 'string', description: 'معرف المستودع المصدر (من search.warehouses)' },
        toWarehouseId: { type: 'string', description: 'معرف المستودع الوجهة (من search.warehouses)' },
        quantity: { type: 'number', description: 'الكمية المنقولة' },
      },
      required: ['productId', 'fromWarehouseId', 'toWarehouseId', 'quantity'],
    },
    summarizeArgs: (a) => `تحويل ${a.quantity} وحدة من مستودع إلى آخر (المنتج: ${String(a.productId).slice(0, 8)}…)`,
    execute: async (args, ctx) => {
      const productId = str(args.productId);
      const fromWarehouseId = str(args.fromWarehouseId);
      const toWarehouseId = str(args.toWarehouseId);
      const quantity = num(args.quantity);

      if (!productId) return { error: 'productId مطلوب — استخدم search.products أولاً' };
      if (!fromWarehouseId) return { error: 'fromWarehouseId مطلوب — استخدم search.warehouses أولاً' };
      if (!toWarehouseId) return { error: 'toWarehouseId مطلوب — استخدم search.warehouses أولاً' };
      if (fromWarehouseId === toWarehouseId) return { error: 'لا يمكن التحويل لنفس المستودع' };
      if (quantity <= 0) return { error: 'الكمية يجب أن تكون أكبر من صفر' };

      // Use the internal adapter directly for this multi-step operation
      const { getDbAdapter } = await import('@/core/database/adapters');
      const adapter = await getDbAdapter();

      // Check source stock before creating any document
      const srcCheck = await adapter.query(
        'SELECT quantity FROM stock WHERE product_id = $1::uuid AND warehouse_id = $2::uuid AND company_id = $3::uuid',
        [productId, fromWarehouseId, ctx.companyId]
      );
      const currentQty = Number(srcCheck.rows?.[0]?.quantity ?? 0);
      if (currentQty < quantity) {
        return { error: `الكمية غير متوفرة في المستودع المصدر. المتاح: ${currentQty}، المطلوب: ${quantity}` };
      }

      // Generate a sequential transfer number and create the numbered document
      const trfNum = await getNextDocumentNumber(ctx.companyId, 'inventory_transfer');
      if (!trfNum.success || !trfNum.number) return { error: trfNum.error || 'فشل توليد رقم التحويل' };
      const docRes = await inventoryApi.createStockTransfer({
        companyId: ctx.companyId,
        fromWarehouseId,
        toWarehouseId,
        date: today(),
        transferNumber: trfNum.number,
        notes: `تحويل تلقائي عبر المساعد: ${quantity} وحدة`,
        status: 'completed',
        lines: [{ productId, quantity }],
      });
      if (!docRes.success) return { error: docRes.error || 'فشل إنشاء مستند التحويل' };

      // Step 1: Deduct from source
      const deductRes = await adapter.query(
        `UPDATE stock SET quantity = quantity - $1::numeric, updated_at = NOW()
         WHERE product_id = $2::uuid AND warehouse_id = $3::uuid AND company_id = $4::uuid`,
        [quantity, productId, fromWarehouseId, ctx.companyId]
      );
      if (!deductRes.success) {
        await inventoryApi.deleteStockTransfer(String(docRes.id), ctx.companyId);
        return { error: 'فشل إنقاص المخزون من المستودع المصدر' };
      }

      // Step 2: Add to destination (insert if not exists, update if exists)
      const addRes = await adapter.query(
        `INSERT INTO stock (company_id, product_id, warehouse_id, quantity, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric, NOW(), NOW())
         ON CONFLICT (company_id, product_id, warehouse_id)
         DO UPDATE SET quantity = stock.quantity + $4::numeric, updated_at = NOW()`,
        [ctx.companyId, productId, toWarehouseId, quantity]
      );
      if (!addRes.success) {
        // Rollback: restore source + remove the numbered document
        await adapter.query(
          `UPDATE stock SET quantity = quantity + $1::numeric, updated_at = NOW()
           WHERE product_id = $2::uuid AND warehouse_id = $3::uuid AND company_id = $4::uuid`,
          [quantity, productId, fromWarehouseId, ctx.companyId]
        );
        await inventoryApi.deleteStockTransfer(String(docRes.id), ctx.companyId);
        return { error: `فشل إضافة المخزون للمستودع الوجهة. تم التراجع: ${addRes.error}` };
      }

      return {
        success: true,
        transferNumber: trfNum.number,
        transferId: docRes.id,
        productId,
        fromWarehouseId,
        toWarehouseId,
        quantity,
        note: `تم تحويل ${quantity} وحدة بنجاح — رقم التحويل: ${trfNum.number}`,
      };
    },
  },

  // ─── HR: Process Payroll Flow ─────────────────────────────────────────
  {
    name: 'hr.process_payroll_flow',
    labelAr: 'معالجة مسير رواتب كامل',
    descriptionAr: 'ينشئ مسير رواتب ويرحّله فوراً. يحسب الإجمالي تلقائياً من الخطوط. استخدم search.employees أولاً لإيجاد معرف كل موظف.',
    permission: 'hr.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'number', description: 'الشهر (1-12)' },
        year: { type: 'number', description: 'السنة (مثال: 2026)' },
        lines: {
          type: 'array',
          description: 'خطوط الرواتب. احصل على employeeId من search.employees',
          items: {
            type: 'object',
            properties: {
              employeeId: { type: 'string', description: 'معرف الموظف (من search.employees)' },
              baseSalary: { type: 'number', description: 'الراتب الأساسي' },
              allowances: { type: 'number', description: 'البدلات (اختياري، افتراضي 0)' },
              deductions: { type: 'number', description: 'الخصومات (اختياري، افتراضي 0)' },
              overtime: { type: 'number', description: 'الإضافي (اختياري، افتراضي 0)' },
              netSalary: { type: 'number', description: 'صافي الراتب = base + allowances + overtime - deductions' },
            },
            required: ['employeeId', 'baseSalary', 'netSalary'],
          },
        },
      },
      required: ['month', 'year', 'lines'],
    },
    summarizeArgs: (a) => {
      const count = Array.isArray(a.lines) ? a.lines.length : 0;
      return `معالجة مسير رواتب — الشهر ${a.month}/${a.year} — ${count} موظف`;
    },
    execute: async (args, ctx) => {
      const month = Number(args.month);
      const year = Number(args.year);
      if (month < 1 || month > 12) return { error: 'الشهر يجب أن يكون بين 1 و 12' };
      if (year < 2000 || year > 2100) return { error: 'السنة خارج النطاق (2000-2100)' };

      const rawLines = args.lines;
      if (!Array.isArray(rawLines) || rawLines.length === 0) return { error: 'يجب تمرير موظف واحد على الأقل في lines' };

      const lines: Array<{ employeeId: string; baseSalary: number; allowances: number; deductions: number; overtime: number; netSalary: number }> = [];
      for (const item of rawLines) {
        const emp = (item as Record<string, unknown>);
        const employeeId = typeof emp.employeeId === 'string' && emp.employeeId ? emp.employeeId.trim() : undefined;
        if (!employeeId) return { error: 'كل موظف يحتاج employeeId — استخدم search.employees أولاً' };
        const baseSalary = Number(emp.baseSalary) || 0;
        const allowances = Number(emp.allowances) || 0;
        const deductions = Number(emp.deductions) || 0;
        const overtime = Number(emp.overtime) || 0;
        const netSalary = Number(emp.netSalary) || 0;
        if (baseSalary <= 0) return { error: 'الراتب الأساسي يجب أن يكون أكبر من صفر' };
        if (netSalary <= 0) return { error: 'صافي الراتب يجب أن يكون أكبر من صفر' };
        lines.push({ employeeId, baseSalary, allowances, deductions, overtime, netSalary });
      }

      const totalAmount = lines.reduce((s, l) => s + l.netSalary, 0);

      // Use dynamic import to get hrApi (to avoid circular deps)
      const { hrApi } = await import('@/modules/hr/api');

      // Step 1: Create draft payroll
      const createRes = await hrApi.createPayrollRun({
        companyId: ctx.companyId,
        month,
        year,
        totalAmount,
        status: 'draft',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lines: lines as any,
      });
      if (!createRes.success) return { error: createRes.error || 'فشل إنشاء مسير الرواتب' };
      const payrollId = createRes.id;
      if (!payrollId) return { error: 'تم إنشاء المسير لكن لم يُرجع معرف' };

      // Step 2: Post the payroll
      const postRes = await hrApi.postPayrollRun(payrollId, ctx.companyId);
      if (!postRes.success) {
        // No delete API for payroll, warn user
        return { 
          error: `تم إنشاء المسير لكن فشل الترحيل: ${postRes.error}. المسير محفوظ كمسودة (id: ${payrollId}).`,
          partialSuccess: true,
          payrollId,
          status: 'draft',
        };
      }

      return {
        success: true,
        payrollId,
        month,
        year,
        totalAmount,
        employeeCount: lines.length,
        status: 'posted',
        message: `تم إنشاء وترحيل مسير رواتب شهر ${month}/${year} بنجاح (${lines.length} موظف، الإجمالي: ${totalAmount})`,
      };
    },
  },

  // ─── Accounting: Create + Post Journal Entry ───────────────────────────
  {
    name: 'accounting.create_journal_flow',
    labelAr: 'إنشاء وترحيل قيد يومي',
    descriptionAr: 'ينشئ قيداً يومياً (قيد محاسبي) ويرحّله فوراً من مسودة إلى مرحّل. يجب أن يتساوى مجموع الديون (debit) مع مجموع الأرصان (credit). استخدم search.accounts أولاً لإيجاد معرف كل حساب.',
    permission: 'accounting.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'تاريخ القيد YYYY-MM-DD (اختياري، افتراضي اليوم)' },
        description: { type: 'string', description: 'وصف القيد (مثال: "قيد إقفال نهاية الشهر")' },
        reference: { type: 'string', description: 'رقم المرجع (اختياري)' },
        lines: {
          type: 'array',
          description: 'أرصان القيد (debit/credit). احصل على accountId من search.accounts. يجب أن يكون مجموع الديون = مجموع الأرصان.',
          items: {
            type: 'object',
            properties: {
              accountId: { type: 'string', description: 'معرف الحساب (من search.accounts)' },
              debit: { type: 'number', description: 'مبلغ الدين/المدين (0 إن لم يكن)' },
              credit: { type: 'number', description: 'مبلغ الدائن/الرصان (0 إن لم يكن)' },
            },
            required: ['accountId'],
          },
        },
      },
      required: ['lines'],
    },
    summarizeArgs: (a) => {
      const count = Array.isArray(a.lines) ? a.lines.length : 0;
      const total = Array.isArray(a.lines) ? a.lines.reduce((s: number, l: Record<string, unknown>) => s + (Number(l.debit) || 0), 0) : 0;
      return `إنشاء قيد يومي — ${count} سطر — إجمالي الديون: ${total}`;
    },
    execute: async (args, ctx) => {
      const rawLines = args.lines;
      if (!Array.isArray(rawLines) || rawLines.length < 2) return { error: 'يجب تمرير سطرين على الأقل (دين واحد على الأقل ودائن واحد على الأقل)' };

      const lines: Array<{ accountId: string; debit: number; credit: number }> = [];
      let totalDebit = 0;
      let totalCredit = 0;

      for (const item of rawLines) {
        const it = (item as Record<string, unknown>);
        const accountId = typeof it.accountId === 'string' && it.accountId ? it.accountId.trim() : undefined;
        if (!accountId) return { error: 'كل سطر يحتاج accountId — استخدم search.accounts أولاً' };
        const debit = Number(it.debit) || 0;
        const credit = Number(it.credit) || 0;
        if (debit === 0 && credit === 0) return { error: 'كل سطر يجب أن يحتوي debit أو credit بقيمة أكبر من صفر' };
        if (debit > 0 && credit > 0) return { error: 'السطر لا يمكن أن يحتوي debit و credit معاً — اختر واحداً' };
        lines.push({ accountId, debit, credit });
        totalDebit += debit;
        totalCredit += credit;
      }

      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        return { error: `مجموع الديون (${totalDebit.toFixed(2)}) لا يساوي مجموع الأرصان (${totalCredit.toFixed(2)}) — يجب أن يتساويا` };
      }

      const { accountingApi } = await import('@/modules/accounting/api');

      let reference: string | undefined = typeof args.reference === 'string' && args.reference ? args.reference : undefined;
      if (!reference) {
        const seq = await getNextDocumentNumber(ctx.companyId, 'journal_voucher');
        if (!seq.success || !seq.number) return { error: seq.error || 'فشل توليد رقم القيد' };
        reference = seq.number;
      }

      // Step 1: Create draft transaction
      const entries = lines.map(l => ({ accountId: l.accountId, debit: l.debit, credit: l.credit }));
      const createRes = await accountingApi.createTransaction({
        companyId: ctx.companyId,
        date: typeof args.date === 'string' && args.date ? args.date : new Date().toISOString().split('T')[0],
        description: typeof args.description === 'string' ? args.description : '',
        reference,
        totalAmount: totalDebit,
        status: 'draft',
        entries: entries as unknown as import('@/modules/accounting/types').JournalEntry[],
      }, '');
      if (!createRes.success) return { error: createRes.error || 'فشل إنشاء القيد' };
      const transactionId = createRes.id;
      if (!transactionId) return { error: 'تم إنشاء القيد لكن لم يُرجع معرف' };

      // Step 2: Post the transaction
      const postRes = await accountingApi.postTransaction(transactionId, ctx.companyId);
      if (!postRes.success) {
        // Rollback: delete the draft transaction
        await accountingApi.deleteTransaction(transactionId, ctx.companyId);
        return { error: `تم إنشاء القيد لكن فشل الترحيل: ${postRes.error}. تم التراجع عن الإنشاء.` };
      }

      return {
        success: true,
        transactionId,
        date: typeof args.date === 'string' && args.date ? args.date : new Date().toISOString().split('T')[0],
        description: typeof args.description === 'string' ? args.description : '',
        linesCount: lines.length,
        totalDebit,
        totalCredit,
        status: 'posted',
      };
    },
  },
];

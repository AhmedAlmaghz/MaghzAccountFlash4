import type { ToolDefinition } from '../types';
import { getDbAdapter } from '@/core/database/adapters';
import { salesService } from '@/modules/sales/services';

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function dateRange(from?: string, to?: string): { from: string; to: string } {
  const now = new Date();
  return {
    from: typeof from === 'string' && from ? from : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
    to: typeof to === 'string' && to ? to : now.toISOString().split('T')[0],
  };
}
function paymentLabel(): string {
  return `CASE WHEN COALESCE(paid_amount,0) >= total_amount THEN 'نقد' WHEN COALESCE(paid_amount,0) = 0 THEN 'أجل' ELSE 'آجل جزئي' END AS payment_label`;
}

export const detailedReportTools: ToolDefinition[] = [

  // ═══════════════════════════════════════════════════════════════════════════
  // المبيعات التفصيلية — Sales Detailed Reports
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'sales.invoices_detailed',
    labelAr: 'فواتير مبيعات تفصيلية',
    descriptionAr: 'سجل فواتير المبيعات بفلترة متقدمة: فترة، عميل، منتج، نقد/أجل، مستخدم، مع تجميعات (الإجمالي، المدفوع، عدد نقدي/آجل).',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object', properties: {
        fromDate: { type: 'string' }, toDate: { type: 'string' },
        customerId: { type: 'string' }, productId: { type: 'string' },
        paymentType: { type: 'string', enum: ['cash', 'credit', 'partial'] },
        createdBy: { type: 'string' }, sortDir: { type: 'string', enum: ['asc', 'desc'] },
        limit: { type: 'number' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string, args.toDate as string);
      const adapter = await getDbAdapter();
      const limit = Math.min(Math.max(num(args.limit) || 50, 5), 200);
      const sDir = (args.sortDir === 'asc') ? 'ASC' : 'DESC';
      const cnd: string[] = ['i.company_id=$1::uuid', 'i.date BETWEEN $2 AND $3', "i.status!='cancelled'"];
      const p: unknown[] = [ctx.companyId, from, to];

      if (typeof args.customerId === 'string' && args.customerId) { p.push(args.customerId); cnd.push(`i.customer_id=$${p.length}::uuid`); }
      if (typeof args.createdBy === 'string' && args.createdBy) { p.push(args.createdBy); cnd.push(`i.created_by=$${p.length}::uuid`); }
      if (typeof args.paymentType === 'string') {
        if (args.paymentType === 'cash') cnd.push('COALESCE(i.paid_amount,0) >= i.total_amount');
        else if (args.paymentType === 'credit') cnd.push('COALESCE(i.paid_amount,0) < i.total_amount');
        else if (args.paymentType === 'partial') cnd.push('COALESCE(i.paid_amount,0)>0 AND COALESCE(i.paid_amount,0)<i.total_amount');
      }
      if (typeof args.productId === 'string' && args.productId) {
        p.push(args.productId);
        cnd.push(`EXISTS(SELECT 1 FROM sales_invoice_lines sil WHERE sil.invoice_id=i.id AND sil.product_id=$${p.length}::uuid)`);
      }
      const w = cnd.join(' AND ');
      p.push(limit);

      const [det, agg] = await Promise.all([
        adapter.query(`SELECT i.invoice_number,i.date,i.due_date,i.total_amount,i.paid_amount,i.status,i.currency_code,c.name AS customer_name,u.full_name AS created_by_name,(i.total_amount-COALESCE(i.paid_amount,0)) AS outstanding,${paymentLabel()} FROM sales_invoices i LEFT JOIN customers c ON i.customer_id=c.id LEFT JOIN users u ON i.created_by=u.id WHERE ${w} ORDER BY i.date ${sDir} LIMIT $${p.length}`, p),
        adapter.query(`SELECT COALESCE(SUM(i.total_amount),0) AS t,COALESCE(SUM(i.paid_amount),0) AS pd,COUNT(*)::int AS c,COALESCE(SUM(i.total_amount-COALESCE(i.paid_amount,0)),0) AS o,COUNT(*) FILTER(WHERE COALESCE(i.paid_amount,0)>=i.total_amount)::int AS cc,COUNT(*) FILTER(WHERE COALESCE(i.paid_amount,0)=0)::int AS cr,COUNT(*) FILTER(WHERE COALESCE(i.paid_amount,0)>0 AND COALESCE(i.paid_amount,0)<i.total_amount)::int AS pp FROM sales_invoices i WHERE ${w}`, p.slice(0, -1)),
      ]);

      const rows = (det.rows || []).map((r: Record<string, unknown>) => ({
        number: r.invoice_number, customer: r.customer_name, date: r.date, dueDate: r.due_date,
        total: num(r.total_amount), paid: num(r.paid_amount), outstanding: num(r.outstanding),
        paymentLabel: r.payment_label, currency: r.currency_code, status: r.status,
        createdBy: r.created_by_name || '',
      }));
      const a = (agg.rows?.[0] || {}) as Record<string, unknown>;
      return {
        period: { from, to }, count: rows.length,
        totals: { total: Math.round(num(a.t) * 100) / 100, paid: Math.round(num(a.pd) * 100) / 100, outstanding: Math.round(num(a.o) * 100) / 100 },
        breakdown: { cash: num(a.cc), credit: num(a.cr), partial: num(a.pp) },
        invoices: rows,
      };
    },
  },

  {
    name: 'sales.quotations_detailed',
    labelAr: 'عروض أسعار تفصيلية',
    descriptionAr: 'عروض الأسعار بفلاتر: فترة، عميل، حالة. مع إجمالي الصفقات المحتملة.',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object', properties: {
        fromDate: { type: 'string' }, toDate: { type: 'string' },
        customerId: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'sent', 'accepted', 'rejected', 'converted'] },
        createdBy: { type: 'string' }, sortDir: { type: 'string', enum: ['asc', 'desc'] },
        limit: { type: 'number' },
      },
    },
    execute: async (args) => {
      const { from, to } = dateRange(args.fromDate as string, args.toDate as string);
      const limit = Math.min(Math.max(num(args.limit) || 50, 5), 200);
      // Use service layer instead of direct API for better business logic enforcement
      const res = await salesService.getInvoicesPaginated(1, limit, {
        status: typeof args.status === 'string' ? args.status : undefined,
        customerId: typeof args.customerId === 'string' ? args.customerId : undefined,
      });
      if (!res.success) return { error: 'فشل جلب عروض الأسعار' };
      const filtered = res.data.items.filter((q: Record<string, unknown>) =>
        String(q.date) >= from && String(q.date) <= to
      );
      const totalVal = filtered.reduce((s: number, q: Record<string, unknown>) => s + (num(q.total_amount) || 0), 0);
      return {
        period: { from, to }, totalDatabase: res.data.total, filteredCount: filtered.length,
        totalValue: Math.round(totalVal * 100) / 100,
        quotations: filtered.map((q: Record<string, unknown>) => ({
          number: String(q.invoice_number), customer: String(q.customer_name || ''),
          date: String(q.date), expiryDate: String(q.due_date || ''), total: num(q.total_amount), status: String(q.status),
        })),
      };
    },
  },
  {
    name: 'sales.returns_detailed',
    labelAr: 'مردودات مبيعات تفصيلية',
    descriptionAr: 'مردودات المبيعات بفلترة: فترة، عميل، مستخدم.',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object', properties: {
        fromDate: { type: 'string' }, toDate: { type: 'string' },
        customerId: { type: 'string' }, createdBy: { type: 'string' },
        sortDir: { type: 'string', enum: ['asc', 'desc'] }, limit: { type: 'number' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string, args.toDate as string);
      const adapter = await getDbAdapter();
      const limit = Math.min(Math.max(num(args.limit) || 50, 5), 200);
      const sDir = (args.sortDir === 'asc') ? 'ASC' : 'DESC';
      const cnd: string[] = ['sr.company_id=$1::uuid', 'sr.date BETWEEN $2 AND $3'];
      const p: unknown[] = [ctx.companyId, from, to];
      if (typeof args.customerId === 'string' && args.customerId) { p.push(args.customerId); cnd.push(`sr.customer_id=$${p.length}::uuid`); }
      if (typeof args.createdBy === 'string' && args.createdBy) { p.push(args.createdBy); cnd.push(`sr.created_by=$${p.length}::uuid`); }
      const w = cnd.join(' AND ');
      p.push(limit);

      const [det, agg] = await Promise.all([
        adapter.query(`SELECT sr.return_number,sr.date,sr.total_amount,sr.status,sr.reason,c.name AS customer_name,u.full_name AS created_by_name,si.invoice_number AS orig FROM sales_returns sr LEFT JOIN customers c ON sr.customer_id=c.id LEFT JOIN users u ON sr.created_by=u.id LEFT JOIN sales_invoices si ON sr.invoice_id=si.id WHERE ${w} ORDER BY sr.date ${sDir} LIMIT $${p.length}`, p),
        adapter.query(`SELECT COALESCE(SUM(sr.total_amount),0) AS total,COUNT(*)::int AS cnt FROM sales_returns sr WHERE ${w}`, p.slice(0, -1)),
      ]);
      const rows = (det.rows || []).map((r: Record<string, unknown>) => ({
        returnNumber: r.return_number, customer: r.customer_name,
        date: r.date, total: num(r.total_amount), status: r.status,
        originalInvoice: r.invoice_invoice, reason: r.reason || '', createdBy: r.created_by_name || '',
      }));
      const a = (agg.rows?.[0] || {}) as Record<string, unknown>;
      return {
        period: { from, to }, count: rows.length,
        totalReturns: Math.round(num(a.total) * 100) / 100,
        returns: rows,
      };
    },
  },

  {
    name: 'sales.sales_by_product',
    labelAr: 'مبيعات حسب الصنف',
    descriptionAr: 'تحليل المبيعات حسب الصنف: كمية، إيرادات، عدد العملاء، عدد الفواتير. يدعم فلترة حسب العميل أو المنتج.',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object', properties: {
        fromDate: { type: 'string' }, toDate: { type: 'string' },
        customerId: { type: 'string' }, productId: { type: 'string' },
        sortField: { type: 'string', enum: ['revenue', 'quantity', 'orders'] },
        sortDir: { type: 'string', enum: ['asc', 'desc'] }, limit: { type: 'number' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string, args.toDate as string);
      const adapter = await getDbAdapter();
      const limit = Math.min(Math.max(num(args.limit) || 30, 5), 100);
      const sf = ((args.sortField || 'revenue') === 'revenue') ? 'total_revenue' : (args.sortField === 'quantity') ? 'total_quantity' : 'invoice_count';
      const sDir = (args.sortDir === 'asc') ? 'ASC' : 'DESC';
      const params: unknown[] = [ctx.companyId, from, to];
      let custCond = '';
      if (typeof args.customerId === 'string' && args.customerId) { params.push(args.customerId); custCond = `AND i.customer_id=$${params.length}::uuid`; }
      let prodCond = '';
      if (typeof args.productId === 'string' && args.productId) { params.push(args.productId); prodCond = `AND sil.product_id=$${params.length}::uuid`; }
      params.push(limit);
      const res = await adapter.query(
        `SELECT p.name_ar AS pname,p.code AS pcode,COALESCE(SUM(sil.quantity),0) AS qty,COALESCE(SUM(sil.line_total),0) AS rev,COUNT(DISTINCT i.customer_id)::int AS ccnt,COUNT(DISTINCT i.id)::int AS icnt FROM sales_invoice_lines sil JOIN sales_invoices i ON sil.invoice_id=i.id JOIN products p ON sil.product_id=p.id WHERE i.company_id=$1::uuid AND i.date BETWEEN $2 AND $3 AND i.status!='cancelled' ${custCond} ${prodCond} GROUP BY p.id,p.name_ar,p.code ORDER BY ${sf} ${sDir} LIMIT $${params.length}`, params);
      if (!res.success) return { error: res.error || 'فشل' };
      const rows = (res.rows || []).map((r: Record<string, unknown>) => ({
        product: r.pname, code: r.pcode,
        quantity: Math.round(num(r.qty) * 100) / 100,
        revenue: Math.round(num(r.rev) * 100) / 100,
        customerCount: num(r.ccnt), invoiceCount: num(r.icnt),
      }));
      return {
        period: { from, to }, productCount: rows.length,
        totalRevenue: Math.round(rows.reduce((s, r) => s + r.revenue, 0) * 100) / 100,
        products: rows,
      };
    },
  },

  {
    name: 'sales.sales_by_user',
    labelAr: 'مبيعات حسب المستخدم',
    descriptionAr: 'تحليل المبيعات حسب المستخدمين: عدد الفواتير، الإيرادات، النقدي مقابل الآجل.',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object', properties: {
        fromDate: { type: 'string' }, toDate: { type: 'string' },
        sortDir: { type: 'string', enum: ['asc', 'desc'] }, limit: { type: 'number' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string, args.toDate as string);
      const adapter = await getDbAdapter();
      const sDir = (args.sortDir === 'asc') ? 'ASC' : 'DESC';
      const limit = Math.min(Math.max(num(args.limit) || 20, 5), 50);

      const res = await adapter.query(`
        SELECT u.id, u.full_name,
               COUNT(i.id)::int AS icnt, COALESCE(SUM(i.total_amount),0) AS rev,
               COUNT(*) FILTER(WHERE COALESCE(i.paid_amount,0)>=i.total_amount)::int AS cash_cnt,
               COUNT(*) FILTER(WHERE COALESCE(i.paid_amount,0)=0)::int AS credit_cnt
        FROM users u
        LEFT JOIN sales_invoices i ON i.created_by=u.id AND i.company_id=u.company_id AND i.date BETWEEN $1 AND $2 AND i.status!='cancelled'
        WHERE u.company_id=$1::uuid
        GROUP BY u.id,u.full_name
        HAVING COUNT(i.id) > 0
        ORDER BY rev ${sDir} LIMIT $3
      `, [ctx.companyId, from, to, limit]);

      if (!res.success) return { error: res.error || 'فشل' };
      const rows = (res.rows || []).map((r: Record<string, unknown>) => ({
        user: r.full_name, invoices: num(r.icnt),
        revenue: Math.round(num(r.rev) * 100) / 100,
        cash: num(r.cash_cnt), credit: num(r.credit_cnt),
      }));
      return {
        period: { from, to }, totalRevenue: Math.round(rows.reduce((s, r) => s + r.revenue, 0) * 100) / 100,
        users: rows,
      };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // المشتريات التفصيلية — Purchases Detailed Reports
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'purchases.invoices_detailed',
    labelAr: 'فواتير مشتريات تفصيلية',
    descriptionAr: 'سجل فواتير المشتريات بفلترة متقدمة: فترة، مورد، منتج، نقد/أجل، مستخدم، مع تجميعات.',
    permission: 'purchases.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object', properties: {
        fromDate: { type: 'string' }, toDate: { type: 'string' },
        supplierId: { type: 'string' }, productId: { type: 'string' },
        paymentType: { type: 'string', enum: ['cash', 'credit', 'partial'] },
        createdBy: { type: 'string' }, sortDir: { type: 'string', enum: ['asc', 'desc'] },
        limit: { type: 'number' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string, args.toDate as string);
      const adapter = await getDbAdapter();
      const limit = Math.min(Math.max(num(args.limit) || 50, 5), 200);
      const sDir = (args.sortDir === 'asc') ? 'ASC' : 'DESC';
      const cnd: string[] = ['pi.company_id=$1::uuid', 'pi.date BETWEEN $2 AND $3', "pi.status!='cancelled'"];
      const p: unknown[] = [ctx.companyId, from, to];

      if (typeof args.supplierId === 'string' && args.supplierId) { p.push(args.supplierId); cnd.push(`pi.supplier_id=$${p.length}::uuid`); }
      if (typeof args.createdBy === 'string' && args.createdBy) { p.push(args.createdBy); cnd.push(`pi.created_by=$${p.length}::uuid`); }
      if (typeof args.paymentType === 'string') {
        if (args.paymentType === 'cash') cnd.push('COALESCE(pi.paid_amount,0) >= pi.total_amount');
        else if (args.paymentType === 'credit') cnd.push('COALESCE(pi.paid_amount,0) < pi.total_amount');
      }
      if (typeof args.productId === 'string' && args.productId) {
        p.push(args.productId);
        cnd.push(`EXISTS(SELECT 1 FROM purchase_invoice_lines pil WHERE pil.invoice_id=pi.id AND pil.product_id=$${p.length}::uuid)`);
      }
      const w = cnd.join(' AND ');
      p.push(limit);

      const [det, agg] = await Promise.all([
        adapter.query(`SELECT pi.invoice_number,pi.date,pi.due_date,pi.total_amount,pi.paid_amount,pi.status,pi.currency_code,s.name AS supplier_name,u.full_name AS created_by_name,(pi.total_amount-COALESCE(pi.paid_amount,0)) AS outstanding,${paymentLabel()} FROM purchase_invoices pi LEFT JOIN suppliers s ON pi.supplier_id=s.id LEFT JOIN users u ON pi.created_by=u.id WHERE ${w} ORDER BY pi.date ${sDir} LIMIT $${p.length}`, p),
        adapter.query(`SELECT COALESCE(SUM(pi.total_amount),0) AS t,COALESCE(SUM(pi.paid_amount),0) AS pd,COUNT(*)::int AS c,COUNT(*) FILTER(WHERE COALESCE(pi.paid_amount,0)>=pi.total_amount)::int AS cc,COUNT(*) FILTER(WHERE COALESCE(pi.paid_amount,0)=0)::int AS cr FROM purchase_invoices pi WHERE ${w}`, p.slice(0, -1)),
      ]);

      const rows = (det.rows || []).map((r: Record<string, unknown>) => ({
        number: r.invoice_number, supplier: r.supplier_name,
        date: r.date, dueDate: r.due_date,
        total: num(r.total_amount), paid: num(r.paid_amount), outstanding: num(r.outstanding),
        paymentLabel: r.payment_label, currency: r.currency_code, status: r.status,
        createdBy: r.created_by_name || '',
      }));
      const a = (agg.rows?.[0] || {}) as Record<string, unknown>;
      return {
        period: { from, to }, count: rows.length,
        totals: { total: Math.round(num(a.t) * 100) / 100, paid: Math.round(num(a.pd) * 100) / 100, outstanding: Math.round((num(a.t) - num(a.pd)) * 100) / 100 },
        breakdown: { cash: num(a.cc), credit: num(a.cr) },
        invoices: rows,
      };
    },
  },

  /*** PURCHASES 2 ***/
  {
    name: 'purchases.orders_detailed',
    labelAr: 'أوامر شراء تفصيلية',
    descriptionAr: 'أوامر الشراء بفلاتر: فترة، مورد، حالة، مستخدم.',
    permission: 'purchases.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object', properties: {
        fromDate: { type: 'string' }, toDate: { type: 'string' },
        supplierId: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'confirmed', 'invoiced', 'cancelled'] },
        createdBy: { type: 'string' },
        sortDir: { type: 'string', enum: ['asc', 'desc'] }, limit: { type: 'number' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string, args.toDate as string);
      const adapter = await getDbAdapter();
      const limit = Math.min(Math.max(num(args.limit) || 50, 5), 200);
      const sDir = (args.sortDir === 'asc') ? 'ASC' : 'DESC';
      const cnd: string[] = ['po.company_id=$1::uuid', 'po.date BETWEEN $2 AND $3'];
      const p: unknown[] = [ctx.companyId, from, to];
      if (typeof args.supplierId === 'string' && args.supplierId) { p.push(args.supplierId); cnd.push(`po.supplier_id=$${p.length}::uuid`); }
      if (typeof args.status === 'string' && args.status) { p.push(args.status); cnd.push(`po.status=$${p.length}`); }
      if (typeof args.createdBy === 'string' && args.createdBy) { p.push(args.createdBy); cnd.push(`po.created_by=$${p.length}::uuid`); }
      const w = cnd.join(' AND ');
      p.push(limit);

      const det = await adapter.query(
        `SELECT po.order_number,po.date,po.expected_date,po.total_amount,po.status,s.name AS supplier_name,u.full_name AS created_by_name FROM purchase_orders po LEFT JOIN suppliers s ON po.supplier_id=s.id LEFT JOIN users u ON po.created_by=u.id WHERE ${w} ORDER BY po.date ${sDir} LIMIT $${p.length}`, p);
      if (!det.success) return { error: det.error || 'فشل جلب أوامر الشراء' };
      const rows = (det.rows || []).map((r: Record<string, unknown>) => ({
        orderNumber: r.order_number, supplier: r.supplier_name,
        date: r.date, expectedDate: r.expected_date,
        total: num(r.total_amount), status: r.status, createdBy: r.created_by_name || '',
      }));
      return { period: { from, to }, count: rows.length, orders: rows };
    },
  },

  {
    name: 'purchases.returns_detailed',
    labelAr: 'مردودات مشتريات تفصيلية',
    descriptionAr: 'مردودات المشتريات بفلترة: فترة، مورد، مستخدم.',
    permission: 'purchases.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object', properties: {
        fromDate: { type: 'string' }, toDate: { type: 'string' },
        supplierId: { type: 'string' }, createdBy: { type: 'string' },
        sortDir: { type: 'string', enum: ['asc', 'desc'] }, limit: { type: 'number' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string, args.toDate as string);
      const adapter = await getDbAdapter();
      const limit = Math.min(Math.max(num(args.limit) || 50, 5), 200);
      const sDir = (args.sortDir === 'asc') ? 'ASC' : 'DESC';
      const cnd: string[] = ['pr.company_id=$1::uuid', 'pr.date BETWEEN $2 AND $3'];
      const p: unknown[] = [ctx.companyId, from, to];
      if (typeof args.supplierId === 'string' && args.supplierId) { p.push(args.supplierId); cnd.push(`pr.supplier_id=$${p.length}::uuid`); }
      if (typeof args.createdBy === 'string' && args.createdBy) { p.push(args.createdBy); cnd.push(`pr.created_by=$${p.length}::uuid`); }
      const w = cnd.join(' AND ');
      p.push(limit);

      const [det, agg] = await Promise.all([
        adapter.query(`SELECT pr.return_number,pr.date,pr.total_amount,pr.status,pr.reason,s.name AS supplier_name,u.full_name AS created_by_name,pi.invoice_number AS orig FROM purchase_returns pr LEFT JOIN suppliers s ON pr.supplier_id=s.id LEFT JOIN users u ON pr.created_by=u.id LEFT JOIN purchase_invoices pi ON pr.invoice_id=pi.id WHERE ${w} ORDER BY pr.date ${sDir} LIMIT $${p.length}`, p),
        adapter.query(`SELECT COALESCE(SUM(pr.total_amount),0) AS total,COUNT(*)::int AS cnt FROM purchase_returns pr WHERE ${w}`, p.slice(0, -1)),
      ]);
      const rows = (det.rows || []).map((r: Record<string, unknown>) => ({
        returnNumber: r.return_number, supplier: r.supplier_name,
        date: r.date, total: num(r.total_amount), status: r.status,
        reason: r.reason || '', originalInvoice: r.orig, createdBy: r.created_by_name || '',
      }));
      const a = (agg.rows?.[0] || {}) as Record<string, unknown>;
      return {
        period: { from, to }, count: rows.length,
        totalReturns: Math.round(num(a.total) * 100) / 100,
        returns: rows,
      };
    },
  },

  {
    name: 'purchases.purchases_by_product',
    labelAr: 'مشتريات حسب الصنف',
    descriptionAr: 'تحليل المشتريات حسب الصنف: كمية، قيمة، عدد الموردين، عدد الفواتير.',
    permission: 'purchases.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object', properties: {
        fromDate: { type: 'string' }, toDate: { type: 'string' },
        supplierId: { type: 'string' }, productId: { type: 'string' },
        sortField: { type: 'string', enum: ['value', 'quantity', 'orders'] },
        sortDir: { type: 'string', enum: ['asc', 'desc'] }, limit: { type: 'number' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string, args.toDate as string);
      const adapter = await getDbAdapter();
      const limit = Math.min(Math.max(num(args.limit) || 30, 5), 100);
      const sf = ((args.sortField || 'value') === 'value') ? 'total_value' : (args.sortField === 'quantity') ? 'total_quantity' : 'invoice_count';
      const sDir = (args.sortDir === 'asc') ? 'ASC' : 'DESC';
      const params: unknown[] = [ctx.companyId, from, to];
      let suppCond = '';
      if (typeof args.supplierId === 'string' && args.supplierId) { params.push(args.supplierId); suppCond = `AND i.supplier_id=$${params.length}::uuid`; }
      let prodCond = '';
      if (typeof args.productId === 'string' && args.productId) { params.push(args.productId); prodCond = `AND pil.product_id=$${params.length}::uuid`; }
      params.push(limit);
      const res = await adapter.query(
        `SELECT p.name_ar AS pname,p.code AS pcode,COALESCE(SUM(pil.quantity),0) AS qty,COALESCE(SUM(pil.line_total),0) AS val,COUNT(DISTINCT i.supplier_id)::int AS scnt,COUNT(DISTINCT i.id)::int AS icnt FROM purchase_invoice_lines pil JOIN purchase_invoices i ON pil.invoice_id=i.id JOIN products p ON pil.product_id=p.id WHERE i.company_id=$1::uuid AND i.date BETWEEN $2 AND $3 AND i.status!='cancelled' ${suppCond} ${prodCond} GROUP BY p.id,p.name_ar,p.code ORDER BY ${sf} ${sDir} LIMIT $${params.length}`, params);
      if (!res.success) return { error: res.error || 'فشل' };
      const rows = (res.rows || []).map((r: Record<string, unknown>) => ({
        product: r.pname, code: r.pcode,
        quantity: Math.round(num(r.qty) * 100) / 100,
        value: Math.round(num(r.val) * 100) / 100,
        supplierCount: num(r.scnt), invoiceCount: num(r.icnt),
      }));
      return {
        period: { from, to }, productCount: rows.length,
        totalValue: Math.round(rows.reduce((s, r) => s + r.value, 0) * 100) / 100,
        products: rows,
      };
    },
  },

  {
    name: 'purchases.purchases_by_user',
    labelAr: 'مشتريات حسب المستخدم',
    descriptionAr: 'تحليل المشتريات حسب المستخدمين: عدد الفواتير، القيمة، النقدي مقابل الآجل.',
    permission: 'purchases.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object', properties: {
        fromDate: { type: 'string' }, toDate: { type: 'string' },
        sortDir: { type: 'string', enum: ['asc', 'desc'] }, limit: { type: 'number' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string, args.toDate as string);
      const adapter = await getDbAdapter();
      const sDir = (args.sortDir === 'asc') ? 'ASC' : 'DESC';
      const limit = Math.min(Math.max(num(args.limit) || 20, 5), 50);
      const res = await adapter.query(`
        SELECT u.id, u.full_name,
               COUNT(pi.id)::int AS icnt, COALESCE(SUM(pi.total_amount),0) AS val,
               COUNT(*) FILTER(WHERE COALESCE(pi.paid_amount,0)>=pi.total_amount)::int AS cash_cnt,
               COUNT(*) FILTER(WHERE COALESCE(pi.paid_amount,0)=0)::int AS credit_cnt
        FROM users u
        LEFT JOIN purchase_invoices pi ON pi.created_by=u.id AND pi.company_id=u.company_id AND pi.date BETWEEN $1 AND $2 AND pi.status!='cancelled'
        WHERE u.company_id=$1::uuid
        GROUP BY u.id,u.full_name
        HAVING COUNT(pi.id) > 0
        ORDER BY val ${sDir} LIMIT $3
      `, [ctx.companyId, from, to, limit]);
      if (!res.success) return { error: res.error || 'فشل' };
      const rows = (res.rows || []).map((r: Record<string, unknown>) => ({
        user: r.full_name, invoices: num(r.icnt),
        value: Math.round(num(r.val) * 100) / 100,
        cash: num(r.cash_cnt), credit: num(r.credit_cnt),
      }));
      return {
        period: { from, to }, totalValue: Math.round(rows.reduce((s, r) => s + r.value, 0) * 100) / 100,
        users: rows,
      };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // المخزون — Inventory
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'inventory.movements_detailed',
    labelAr: 'حركات المخزون التفصيلية',
    descriptionAr: 'تسجيل حركات المخزون (داخل، خارج، تحويل، تسوية) بفلترة: فترة، منتج، مستودع، نوع، مستخدم.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object', properties: {
        fromDate: { type: 'string' }, toDate: { type: 'string' },
        productId: { type: 'string' }, warehouseId: { type: 'string' },
        type: { type: 'string', enum: ['in', 'out', 'transfer', 'adjustment'] },
        createdBy: { type: 'string' },
        sortDir: { type: 'string', enum: ['asc', 'desc'] }, limit: { type: 'number' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string, args.toDate as string);
      const adapter = await getDbAdapter();
      const limit = Math.min(Math.max(num(args.limit) || 50, 5), 200);
      const sDir = (args.sortDir === 'asc') ? 'ASC' : 'DESC';
      const cnd: string[] = ['sm.company_id=$1::uuid', 'DATE(sm.created_at) BETWEEN $2 AND $3'];
      const p: unknown[] = [ctx.companyId, from, to];
      if (typeof args.productId === 'string' && args.productId) { p.push(args.productId); cnd.push(`sm.product_id=$${p.length}::uuid`); }
      if (typeof args.warehouseId === 'string' && args.warehouseId) { p.push(args.warehouseId); cnd.push(`sm.warehouse_id=$${p.length}::uuid`); }
      if (typeof args.type === 'string' && args.type) { p.push(args.type); cnd.push(`sm.type=$${p.length}`); }
      if (typeof args.createdBy === 'string' && args.createdBy) { p.push(args.createdBy); cnd.push(`sm.created_by=$${p.length}::uuid`); }
      const w = cnd.join(' AND ');
      p.push(limit);

      const det = await adapter.query(
        `SELECT sm.id,sm.type,sm.quantity,sm.created_at,p.name_ar AS product_name,p.code AS product_code,w.name AS warehouse_name,u.full_name AS created_by_name,sm.reference FROM stock_movements sm LEFT JOIN products p ON sm.product_id=p.id LEFT JOIN warehouses w ON sm.warehouse_id=w.id LEFT JOIN users u ON sm.created_by=u.id WHERE ${w} ORDER BY sm.created_at ${sDir} LIMIT $${p.length}`, p);
      if (!det.success) return { error: det.error || 'فشل جلب حركات المخزون' };
      const rows = (det.rows || []).map((r: Record<string, unknown>) => ({
        id: r.id, date: r.created_at, type: r.type,
        product: r.product_name, code: r.product_code,
        warehouse: r.warehouse_name, quantity: num(r.quantity),
        reference: r.reference || '', createdBy: r.created_by_name || '',
      }));
      return { period: { from, to }, count: rows.length, movements: rows };
    },
  },

  {
    name: 'inventory.stock_status_detailed',
    labelAr: 'حالة المخزون (نشط / راكد)',
    descriptionAr: 'بيان حالة المخزون كاملاً — كم ذو نشاط و كم راكد. تصفية حسب النوع، المستودع، النشاط.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object', properties: {
        productTypeId: { type: 'string' }, warehouseId: { type: 'string' },
        isActive: { type: 'boolean' },
        sortField: { type: 'string', enum: ['quantity', 'value', 'sku'] },
        sortDir: { type: 'string', enum: ['asc', 'desc'] }, limit: { type: 'number' },
      },
    },
    execute: async (args, ctx) => {
      const adapter = await getDbAdapter();
      const limit = Math.min(Math.max(num(args.limit) || 50, 5), 200);
      const sf = ((args.sortField || 'quantity') === 'value') ? 'stock_value' : (args.sortField === 'sku') ? 'p.code' : 's.quantity';
      const sDir = (args.sortDir === 'asc') ? 'ASC' : 'DESC';
      const cnd: string[] = ['s.company_id=$1::uuid'];
      const p: unknown[] = [ctx.companyId];
      if (typeof args.warehouseId === 'string' && args.warehouseId) { p.push(args.warehouseId); cnd.push(`s.warehouse_id=$${p.length}::uuid`); }
      if (typeof args.productTypeId === 'string' && args.productTypeId) { p.push(args.productTypeId); cnd.push(`p.product_type_id=$${p.length}::uuid`); }
      if (typeof args.isActive === 'boolean') {
        cnd.push(args.isActive ? 's.quantity > 0 AND p.is_active=true' : '(s.quantity <= 0 OR p.is_active = false)');
      }
      const w = cnd.join(' AND ');
      p.push(limit);

      const res = await adapter.query(
        `SELECT p.name_ar AS pname,p.code,p.sku,p.cost_price,p.sale_price,p.is_active,s.quantity,w.name AS wname,(s.quantity * COALESCE(p.cost_price,0)) AS stock_value,(s.quantity <= 0 OR p.is_active = false) AS is_dormant FROM stock s LEFT JOIN products p ON s.product_id=p.id LEFT JOIN warehouses w ON s.warehouse_id=w.id WHERE ${w} ORDER BY ${sf} ${sDir} LIMIT $${p.length}`, p);
      if (!res.success) return { error: res.error || 'فشل' };
      const rows = (res.rows || []).map((r: Record<string, unknown>) => ({
        name: r.pname, code: r.code, warehouse: r.wname, quantity: num(r.quantity),
        costPrice: num(r.cost_price), value: Math.round(num(r.stock_value) * 100) / 100,
        isDormant: Boolean(r.is_dormant),
      }));
      return {
        productCount: rows.length,
        activeCount: rows.filter(r => !r.isDormant).length,
        dormantCount: rows.filter(r => r.isDormant).length,
        totalValue: Math.round(rows.reduce((s, r) => s + r.value, 0) * 100) / 100,
        items: rows,
      };
    },
  },

  {
    name: 'inventory.stock_by_warehouse',
    labelAr: 'المخزون حسب المستودع',
    descriptionAr: 'تجميع المخزون حسب المستودع: عدد الأصناف، إجمالي الكمية، القيمة.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object', properties: {
        sortField: { type: 'string', enum: ['count', 'quantity', 'value'] },
        sortDir: { type: 'string', enum: ['asc', 'desc'] }, limit: { type: 'number' },
      },
    },
    execute: async (args, ctx) => {
      const adapter = await getDbAdapter();
      const sf = ((args.sortField || 'value') === 'quantity') ? 'total_quantity' : (args.sortField === 'count') ? 'product_count' : 'total_value';
      const sDir = (args.sortDir === 'asc') ? 'ASC' : 'DESC';
      const limit = Math.min(Math.max(num(args.limit) || 30, 5), 100);
      const res = await adapter.query(
        `SELECT w.id,w.name AS wname,COUNT(DISTINCT s.product_id)::int AS _n,COALESCE(SUM(s.quantity),0) AS qty,COALESCE(SUM(s.quantity * COALESCE(p.cost_price,0)),0) AS val FROM stock s JOIN warehouses w ON s.warehouse_id=w.id LEFT JOIN products p ON s.product_id=p.id WHERE s.company_id=$1::uuid GROUP BY w.id,w.name ORDER BY ${sf} ${sDir} LIMIT $2`, [ctx.companyId, limit]);
      if (!res.success) return { error: res.error || 'فشل' };
      const rows = (res.rows || []).map((r: Record<string, unknown>) => ({
        warehouse: r.wname, productCount: num(r._n),
        totalQuantity: Math.round(num(r.qty) * 100) / 100,
        totalValue: Math.round(num(r.val) * 100) / 100,
      }));
      return {
        warehouses: rows,
        grandTotal: { quantity: Math.round(rows.reduce((s, r) => s + r.totalQuantity, 0) * 100) / 100, value: Math.round(rows.reduce((s, r) => s + r.totalValue, 0) * 100) / 100 },
      };
    },
  },

  {
    name: 'inventory.movements_by_party',
    labelAr: 'حركات حسب العميل/المورد',
    descriptionAr: 'حركات المخزون المرتبطة بعميل أو مورد. تظهر لكل حركة الجهة الطرفية.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object', properties: {
        fromDate: { type: 'string' }, toDate: { type: 'string' },
        sortDir: { type: 'string', enum: ['asc', 'desc'] }, limit: { type: 'number' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string, args.toDate as string);
      const adapter = await getDbAdapter();
      const limit = Math.min(Math.max(num(args.limit) || 50, 5), 200);
      const sDir = (args.sortDir === 'asc') ? 'ASC' : 'DESC';
      const res = await adapter.query(
        `SELECT sm.created_at,sm.type,sm.quantity,p.name_ar AS product_name,p.code AS pcode,w.name AS warehouse_name,
            CASE WHEN sm.type='out' AND si.id IS NOT NULL THEN c.name
                 WHEN sm.type='in'  AND pi.id IS NOT NULL THEN s.name
                 ELSE NULL END AS party
         FROM stock_movements sm
         LEFT JOIN products p ON sm.product_id=p.id
         LEFT JOIN warehouses w ON sm.warehouse_id=w.id
         LEFT JOIN sales_invoices si ON sm.reference IS NOT NULL AND sm.type='out' AND sm.reference=si.id::text
         LEFT JOIN customers c ON si.customer_id=c.id
         LEFT JOIN purchase_invoices pi ON sm.reference IS NOT NULL AND sm.type='in' AND sm.reference=pi.id::text
         LEFT JOIN suppliers s ON pi.supplier_id=s.id
         WHERE sm.company_id=$1::uuid AND DATE(sm.created_at) BETWEEN $2 AND $3
         ORDER BY sm.created_at ${sDir} LIMIT $4`, [ctx.companyId, from, to, limit]);
      if (!res.success) return { error: res.error || 'فشل' };
      const rows = (res.rows || []).map((r: Record<string, unknown>) => ({
        date: r.created_at, type: r.type, product: r.product_name, code: r.pcode,
        warehouse: r.warehouse_name, quantity: num(r.quantity), party: r.party || '',
      }));
      return { period: { from, to }, count: rows.length, movements: rows };
    },
  },

  {
    name: 'inventory.product_ledger_detailed',
    labelAr: 'كشف حركة منتج واحد',
    descriptionAr: 'كشف الحركات المفصل لمنتج محدد — تصفية حسب الفترة.',
    permission: 'inventory.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object', properties: {
        productId: { type: 'string' },
        fromDate: { type: 'string' }, toDate: { type: 'string' },
        sortDir: { type: 'string', enum: ['asc', 'desc'] }, limit: { type: 'number' },
      },
      required: ['productId'],
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string, args.toDate as string);
      const adapter = await getDbAdapter();
      const limit = Math.min(Math.max(num(args.limit) || 50, 5), 200);
      const sDir = (args.sortDir === 'asc') ? 'ASC' : 'DESC';
      const cnd: string[] = ['sm.company_id=$1::uuid', 'sm.product_id=$2::uuid', 'DATE(sm.created_at) BETWEEN $3 AND $4'];
      const p: unknown[] = [ctx.companyId, args.productId, from, to];
      p.push(limit);
      const w = cnd.join(' AND ');
      const res = await adapter.query(
        `SELECT sm.created_at,sm.type,sm.quantity,sm.reference,p.name_ar AS product_name,p.code AS pcode,w.name AS warehouse_name,
            CASE WHEN sm.type='out' AND si.id IS NOT NULL THEN c.name
                 WHEN sm.type='in'  AND pi.id IS NOT NULL THEN s.name
                 ELSE NULL END AS party
         FROM stock_movements sm
         LEFT JOIN products p ON sm.product_id=p.id
         LEFT JOIN warehouses w ON sm.warehouse_id=w.id
         LEFT JOIN sales_invoices si ON sm.reference IS NOT NULL AND sm.type='out' AND sm.reference=si.id::text
         LEFT JOIN customers c ON si.customer_id=c.id
         LEFT JOIN purchase_invoices pi ON sm.reference IS NOT NULL AND sm.type='in' AND sm.reference=pi.id::text
         LEFT JOIN suppliers s ON pi.supplier_id=s.id
         WHERE ${w} ORDER BY sm.created_at ${sDir} LIMIT $${p.length}`, p);
      if (!res.success) return { error: res.error || 'فشل' };
      const rows = (res.rows || []).map((r: Record<string, unknown>) => ({
        date: r.created_at, type: r.type, quantity: num(r.quantity),
        product: r.product_name, code: r.pcode, warehouse: r.warehouse_name,
        party: r.party || '', reference: r.reference || '',
      }));
      return { period: { from, to }, productId: args.productId, count: rows.length, movements: rows };
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // تحليل نقد / أجل
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'sales.cash_vs_credit',
    labelAr: 'تحليل مبيعات نقد مقابل أجل',
    descriptionAr: 'توزيع فواتير المبيعات على نقد، أجل، جزئي عبر الـ 12 شهر الأخيرة.',
    permission: 'sales.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object', properties: {
        fromDate: { type: 'string' }, toDate: { type: 'string' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string, args.toDate as string);
      const adapter = await getDbAdapter();
      const res = await adapter.query(
        `SELECT TO_CHAR(i.date, 'YYYY-MM') AS month,
           COUNT(*) FILTER(WHERE COALESCE(i.paid_amount,0) >= i.total_amount)::int AS cash_cnt,
           COALESCE(SUM(i.total_amount) FILTER(WHERE COALESCE(i.paid_amount,0) >= i.total_amount),0) AS cash_rev,
           COUNT(*) FILTER(WHERE COALESCE(i.paid_amount,0) = 0)::int AS credit_cnt,
           COALESCE(SUM(i.total_amount) FILTER(WHERE COALESCE(i.paid_amount,0) = 0),0) AS credit_rev,
           COUNT(*) FILTER(WHERE COALESCE(i.paid_amount,0)>0 AND COALESCE(i.paid_amount,0)<i.total_amount)::int AS partial_cnt,
           COALESCE(SUM(i.total_amount) FILTER(WHERE COALESCE(i.paid_amount,0)>0 AND COALESCE(i.paid_amount,0)<i.total_amount),0) AS partial_rev
         FROM sales_invoices i
         WHERE i.company_id=$1::uuid AND i.date BETWEEN $2 AND $3 AND i.status != 'cancelled'
         GROUP BY month
         ORDER BY month`, [ctx.companyId, from, to]);
      if (!res.success) return { error: res.error || 'فشل' };
      const months = (res.rows || []).map((r: Record<string, unknown>) => ({
        month: r.month,
        cash: { count: num(r.cash_cnt), revenue: Math.round(num(r.cash_rev) * 100) / 100 },
        credit: { count: num(r.credit_cnt), revenue: Math.round(num(r.credit_rev) * 100) / 100 },
        partial: { count: num(r.partial_cnt), revenue: Math.round(num(r.partial_rev) * 100) / 100 },
      }));
      return {
        period: { from, to }, monthly: months,
        totals: {
          cash: { count: months.reduce((s, m) => s + m.cash.count, 0), revenue: Math.round(months.reduce((s, m) => s + m.cash.revenue, 0) * 100) / 100 },
          credit: { count: months.reduce((s, m) => s + m.credit.count, 0), revenue: Math.round(months.reduce((s, m) => s + m.credit.revenue, 0) * 100) / 100 },
          partial: { count: months.reduce((s, m) => s + m.partial.count, 0), revenue: Math.round(months.reduce((s, m) => s + m.partial.revenue, 0) * 100) / 100 },
        },
      };
    },
  },

  {
    name: 'purchases.cash_vs_credit',
    labelAr: 'تحليل مشتريات نقد مقابل أجل',
    descriptionAr: 'توزيع فواتير المشتريات على فئات نقد، أجل، مجزء عبر الـ 12 شهر الأخيرة.',
    permission: 'purchases.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object', properties: {
        fromDate: { type: 'string' }, toDate: { type: 'string' },
      },
    },
    execute: async (args, ctx) => {
      const { from, to } = dateRange(args.fromDate as string, args.toDate as string);
      const adapter = await getDbAdapter();
      const res = await adapter.query(
        `SELECT TO_CHAR(pi.date, 'YYYY-MM') AS month,
           COUNT(*) FILTER(WHERE COALESCE(pi.paid_amount,0) >= pi.total_amount)::int AS cash_cnt,
           COALESCE(SUM(pi.total_amount) FILTER(WHERE COALESCE(pi.paid_amount,0) >= pi.total_amount),0) AS cash_val,
           COUNT(*) FILTER(WHERE COALESCE(pi.paid_amount,0) = 0)::int AS credit_cnt,
           COALESCE(SUM(pi.total_amount) FILTER(WHERE COALESCE(pi.paid_amount,0) = 0),0) AS credit_val,
           COUNT(*) FILTER(WHERE COALESCE(pi.paid_amount,0)>0 AND COALESCE(pi.paid_amount,0)<pi.total_amount)::int AS partial_cnt,
           COALESCE(SUM(pi.total_amount) FILTER(WHERE COALESCE(pi.paid_amount,0)>0 AND COALESCE(pi.paid_amount,0)<pi.total_amount),0) AS partial_val
         FROM purchase_invoices pi
         WHERE pi.company_id=$1::uuid AND pi.date BETWEEN $2 AND $3 AND pi.status != 'cancelled'
         GROUP BY month ORDER BY month`, [ctx.companyId, from, to]);
      if (!res.success) return { error: res.error || 'فشل' };
      const months = (res.rows || []).map((r: Record<string, unknown>) => ({
        month: r.month,
        cash: { count: num(r.cash_cnt), value: Math.round(num(r.cash_val) * 100) / 100 },
        credit: { count: num(r.credit_cnt), value: Math.round(num(r.credit_val) * 100) / 100 },
        partial: { count: num(r.partial_cnt), value: Math.round(num(r.partial_val) * 100) / 100 },
      }));
      return {
        period: { from, to }, monthly: months,
        totals: {
          cash: { count: months.reduce((s, m) => s + m.cash.count, 0), value: Math.round(months.reduce((s, m) => s + m.cash.value, 0) * 100) / 100 },
          credit: { count: months.reduce((s, m) => s + m.credit.count, 0), value: Math.round(months.reduce((s, m) => s + m.credit.value, 0) * 100) / 100 },
          partial: { count: months.reduce((s, m) => s + m.partial.count, 0), value: Math.round(months.reduce((s, m) => s + m.partial.value, 0) * 100) / 100 },
        },
      };
    },
  },

];
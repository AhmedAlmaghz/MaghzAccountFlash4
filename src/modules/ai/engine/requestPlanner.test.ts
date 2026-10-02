import { describe, it, expect } from 'vitest';
import { planRequest } from './requestPlanner';

describe('requestPlanner — deterministic per-request planning', () => {
  it('plans a cash sales invoice: intent + tool + cash + qty/price + 3 entity requests', () => {
    const p = planRequest('أنشئ فاتورة مبيعات نقدية لعميل محمد الأحمدي 10 وحدات كرتون بـ 500 ريال');
    expect(p.intent).toBe('sales.invoice');
    expect(p.writeTool).toBe('sales.create_invoice');
    expect(p.slots.paymentType).toBe('cash');
    expect(p.slots.quantities).toEqual([10]);
    expect(p.slots.prices).toEqual([500]);
    expect(p.entityRequests.map((e) => e.kind).sort()).toEqual(
      ['cash_box', 'customer', 'product'].sort(),
    );
    expect(p.missing).toEqual([]);
    expect(p.plan).toBe('single-write');
  });

  it('defaults to credit when no cash word is present', () => {
    const p = planRequest('فاتورة مبيعات للعميل محمد 5 قطع بـ 200');
    expect(p.intent).toBe('sales.invoice');
    expect(p.slots.paymentType).toBe('credit');
    expect(p.entityRequests.map((e) => e.kind)).not.toContain('cash_box');
  });

  it('asks once when price is missing (never invents prices)', () => {
    const p = planRequest('أنشئ فاتورة مبيعات للعميل محمد 10 وحدات كرتون');
    expect(p.plan).toBe('ask');
    expect(p.missing.some((m) => m.field === 'unitPrice')).toBe(true);
  });

  it('asks once when quantity is missing', () => {
    const p = planRequest('فاتورة مبيعات للعميل محمد بسعر 500');
    // "500" parses as the single number → quantity by convention; price missing.
    expect(p.missing.some((m) => m.field === 'unitPrice')).toBe(true);
  });

  it('plans purchase invoices with supplier + product', () => {
    const p = planRequest('فاتورة شراء من المورد الشجاع 20 كيس بـ 150');
    expect(p.intent).toBe('purchases.invoice');
    expect(p.writeTool).toBe('purchases.create_invoice');
    expect(p.entityRequests.map((e) => e.kind).sort()).toEqual(['product', 'supplier'].sort());
  });

  it('plans receipt vouchers and flags missing amounts', () => {
    const ok = planRequest('سند قبض من العميل محمد بمبلغ 5000');
    expect(ok.intent).toBe('accounting.receipt');
    expect(ok.plan).toBe('single-write');
    const missing = planRequest('سند قبض من العميل محمد');
    expect(missing.plan).toBe('ask');
    expect(missing.missing.some((m) => m.field === 'amount')).toBe(true);
  });

  it('falls back to generic for chit-chat (model-driven, no forced plan)', () => {
    const p = planRequest('مرحبا شكرا');
    expect(p.intent).toBe('generic');
    expect(p.plan).toBe('generic');
    expect(p.writeTool).toBeNull();
  });

  it('parses Arabic-Indic digits like the executor does', () => {
    const p = planRequest('فاتورة مبيعات للعميل محمد ١٠ وحدات بـ ٥٠٠');
    expect(p.slots.quantities).toEqual([10]);
    expect(p.slots.prices).toEqual([500]);
  });

  it('pairs multi-line invoices in reading order (C3)', () => {
    const p = planRequest('فاتورة مبيعات للعميل محمد 10 كرتون بـ 500 و5 علب بـ 200');
    expect(p.plan).toBe('single-write');
    expect(p.slots.lines).toEqual([
      { quantity: 10, unitPrice: 500 },
      { quantity: 5, unitPrice: 200 },
    ]);
  });

  it('asks once for the priceless trailing line only', () => {
    const p = planRequest('فاتورة مبيعات للعميل محمد 10 كرتون بـ 500 و5 علب');
    expect(p.plan).toBe('ask');
    expect(p.slots.lines).toEqual([
      { quantity: 10, unitPrice: 500 },
      { quantity: 5 },
    ]);
    expect(p.missing.some((m) => m.field === 'unitPrice')).toBe(true);
  });

  it('plans manufacturing work orders with product + warehouse (no price asked)', () => {
    const p = planRequest('أنشئ أمر تشغيل 100 علبة زبادي');
    expect(p.intent).toBe('manufacturing.work_order');
    expect(p.writeTool).toBe('manufacturing.create_work_order');
    expect(p.slots.quantities).toEqual([100]);
    expect(p.entityRequests.map((e) => e.kind).sort()).toEqual(['product', 'warehouse'].sort());
    expect(p.plan).toBe('single-write');
  });

  it('asks for work-order quantity when absent', () => {
    const p = planRequest('أنشئ أمر تشغيل لمنتج الزبادي');
    expect(p.intent).toBe('manufacturing.work_order');
    expect(p.missing.some((m) => m.field === 'quantity')).toBe(true);
  });

  it('routes lead/employee/product creation before generic party words', () => {
    expect(planRequest('سجل عميل محتمل اسمه خالد').intent).toBe('crm.lead');
    expect(planRequest('أضف موظف جديد اسمه سالم').intent).toBe('hr.employee');
    expect(planRequest('أضف منتج جديد اسمه سكر').intent).toBe('inventory.product');
  });

  it('infers purchase from supplier party, sales from customer party', () => {
    expect(planRequest('سجل فاتورة من المورد الشجاع ب 10 كرتون بـ 500').intent).toBe('purchases.invoice');
    expect(planRequest('سجل فاتورة للعميل محمد ب 10 كرتون بـ 500').intent).toBe('sales.invoice');
  });

  it('infers purchase from من and sales from لـ prepositions', () => {
    expect(planRequest('فاتورة نقدية من أبو العز ب 6 كنافة').intent).toBe('purchases.invoice');
    expect(planRequest('فاتورة لغدرة ب 5 كرتون').intent).toBe('sales.invoice');
  });

  it('leaves truly undirected invoices to the block (rule 55)', () => {
    const p = planRequest('سجل فاتورة ب 6 كنافة بسعر 300');
    expect(p.intent).toBe('invoice.undirected');
    expect(p.writeTool).toBeNull();
    expect(p.entityRequests.map((e) => e.kind).sort()).toEqual(
      ['customer', 'product', 'supplier'].sort(),
    );
    expect(p.plan).toBe('single-write');
  });
});

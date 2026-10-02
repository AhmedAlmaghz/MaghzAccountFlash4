import { describe, it, expect } from 'vitest';
import { planRequest, renderPlannedSlots, extractJournalLegs } from './requestPlanner';

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

  it('proceeds without asking when only quantity is said (price comes from the catalog)', () => {
    const p = planRequest('أنشئ فاتورة مبيعات للعميل محمد 10 وحدات كرتون');
    expect(p.plan).toBe('single-write');
    expect(p.slots.lines).toEqual([{ quantity: 10 }]);
    expect(renderPlannedSlots(p)).toContain('بطاقة الصنف');
  });

  it('asks quantity (not a bogus qty=500 line) when only a price is said', () => {
    const p = planRequest('فاتورة مبيعات للعميل محمد بسعر 500');
    expect(p.plan).toBe('ask');
    expect(p.slots.lines).toEqual([]);
    expect(p.slots.prices).toEqual([500]);
    expect(p.missing.some((m) => m.field === 'quantity')).toBe(true);
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

  it('keeps priceless trailing lines with catalog-price hint (no blocking ask)', () => {
    const p = planRequest('فاتورة مبيعات للعميل محمد 10 كرتون بـ 500 و5 علب');
    expect(p.plan).toBe('single-write');
    expect(p.slots.lines).toEqual([
      { quantity: 10, unitPrice: 500 },
      { quantity: 5 },
    ]);
    expect(renderPlannedSlots(p)).toContain('بطاقة الصنف');
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

  it('renderPlannedSlots surfaces lines, date and cash hints (nothing discarded)', () => {
    const p = planRequest('فاتورة نقدية للعميل محمد 10 كرتون بـ 500 و5 علب بـ 200 بتاريخ 2026-10-02');
    const hint = renderPlannedSlots(p);
    expect(hint).toContain('10 × بسعر 500');
    expect(hint).toContain('5 × بسعر 200');
    expect(hint).toContain('2026-10-02');
    expect(hint).toContain('نقدي');
  });

  it('renderPlannedSlots stays silent for generic plans and empty slots', () => {
    expect(renderPlannedSlots(planRequest('مرحبا'))).toBeNull();
  });

  it('question gate: information questions never plan a write (no unprompted creation)', () => {
    expect(planRequest('ما رصيد العميل محمد؟').intent).toBe('generic');
    expect(planRequest('بكم الكنافة؟').intent).toBe('generic');
    expect(planRequest('كم فواتير اليوم؟').intent).toBe('generic');
    expect(planRequest('اعرض فواتير العميل محمد').intent).toBe('generic');
  });

  it('terse verb-less commands keep their intent (question gate needs a question form)', () => {
    expect(planRequest('فاتورة نقدية من أبو العز ب 6 كنافة').intent).toBe('purchases.invoice');
    expect(planRequest('سند قبض من غدرة ب 50000').intent).toBe('accounting.receipt');
  });

  it('splits the live-session journal deterministically with a balancing figure', () => {
    const p = planRequest('قم بتسجيل قيد ب 500000 الصندوق الرئيسي و 500000 حساب محفظة جيب من حساب رأس المال');
    expect(p.intent).toBe('accounting.journal');
    expect(p.plan).toBe('single-write');
    // Account texts ride normalized (matching is normalized both sides).
    expect(p.slots.journalLegs).toEqual([
      { accountText: 'الصندوق الرييسي', debit: 500000 },
      { accountText: 'محفظه جيب', debit: 500000 },
      { accountText: 'راس المال', credit: 1000000 },
    ]);
    // One resolution request PER leg (no blob guessing).
    expect(p.entityRequests).toEqual([
      { text: 'الصندوق الرييسي', kind: 'account' },
      { text: 'محفظه جيب', kind: 'account' },
      { text: 'راس المال', kind: 'account' },
    ]);
    expect(renderPlannedSlots(p)).toContain('متوازنة');
  });

  it('asks once for unbalanced journals instead of inventing a plug', () => {
    const p = planRequest('سجل قيد مدين 500000 الصندوق دائن 400000 البنك');
    expect(p.intent).toBe('accounting.journal');
    expect(p.plan).toBe('ask');
    expect(p.missing.some((m) => m.field === 'legs')).toBe(true);
  });

  it('asks once when a journal names no legs at all', () => {
    const p = planRequest('سجل قيد اليوم');
    expect(p.plan).toBe('ask');
    expect(p.missing.some((m) => m.field === 'legs')).toBe(true);
  });

  it('extractJournalLegs honors explicit markers and إلى-destinations', () => {
    expect(
      extractJournalLegs('قيد: مدين 1000 الصندوق، دائن 1000 المبيعات').legs,
    ).toEqual([
      { accountText: 'الصندوق', debit: 1000 },
      { accountText: 'المبيعات', credit: 1000 },
    ]);
    expect(
      extractJournalLegs('سجل قيد 2000 إلى حساب المصروفات من حساب الصندوق').legs,
    ).toEqual([
      { accountText: 'المصروفات', debit: 2000 },
      { accountText: 'الصندوق', credit: 2000 },
    ]);
  });
});

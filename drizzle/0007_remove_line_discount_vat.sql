-- 0007 — Phase A-1: حذف الخصم + الضريبة على مستوى الصنف من الفواتير
-- المستخدم: "قم بحذف الضريبة والخصم على مستوى الصنف في الفواتير وأبقهما على مستوى الفاتورة".
-- الجدولين: sales_invoice_lines (المبيعات) + purchase_invoice_lines (المشتريات).
-- القيم وقت الحذف كانت افتراضية (0/15%) — خطأ سياسة لأن المفترض الحقيقي يغلفه المحرك
-- (invoice.discountPercent/vatAmount) + القيد المحاسبي في build*PostingStatements.
ALTER TABLE sales_invoice_lines DROP COLUMN IF EXISTS discount_percent;
ALTER TABLE sales_invoice_lines DROP COLUMN IF EXISTS vat_percent;
ALTER TABLE purchase_invoice_lines DROP COLUMN IF EXISTS discount_percent;
ALTER TABLE purchase_invoice_lines DROP COLUMN IF EXISTS vat_percent;

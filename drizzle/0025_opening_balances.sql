-- Migration 0025: Opening balances for accounts, customers, suppliers, employees and products
-- Best practice (QuickBooks / Odoo model): every opening balance is posted as a
-- balanced journal entry through the "Opening Balance Equity" account (31201),
-- so the books stay Dr = Cr from day one. Employee advances use a dedicated
-- receivable account (11202) under the receivables group.

-- ============================================================
-- 1) Opening balance columns on entity tables
-- ============================================================
ALTER TABLE customers ADD COLUMN IF NOT EXISTS opening_balance numeric(18,4) NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS opening_balance_posted boolean NOT NULL DEFAULT false;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS opening_balance numeric(18,4) NOT NULL DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS opening_balance_posted boolean NOT NULL DEFAULT false;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS opening_balance numeric(18,4) NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS opening_balance_posted boolean NOT NULL DEFAULT false;

ALTER TABLE products ADD COLUMN IF NOT EXISTS opening_stock_qty numeric(18,4) NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS opening_warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS opening_stock_posted boolean NOT NULL DEFAULT false;

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS opening_amount numeric(18,4) NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS opening_direction varchar(10) NOT NULL DEFAULT 'debit';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS opening_balance_posted boolean NOT NULL DEFAULT false;

-- ============================================================
-- 2) Opening Balance Equity account (31201)
--    Counter-account that absorbs all opening balances so every
--    opening journal entry stays balanced.
-- ============================================================
INSERT INTO accounts (id, company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance, is_active)
SELECT gen_random_uuid(), c.id, '312', 'أرصدة افتتاحية وفروق تسوية', 'Opening Balance & Adjustments', p.id, 'equity', 'credit', true, 0, true
FROM companies c
JOIN accounts p ON p.company_id = c.id AND p.code = '3'
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE company_id = c.id AND code = '312');

INSERT INTO accounts (id, company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance, is_active)
SELECT gen_random_uuid(), c.id, '31201', 'حساب الأرصدة الافتتاحية', 'Opening Balance Equity', g.id, 'equity', 'credit', false, 0, true
FROM companies c
JOIN accounts g ON g.company_id = c.id AND g.code = '312'
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE company_id = c.id AND code = '31201');

-- Fallback: companies whose chart predates group 312 -> attach leaf to root 311/3
INSERT INTO accounts (id, company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance, is_active)
SELECT gen_random_uuid(), c.id, '31201', 'حساب الأرصدة الافتتاحية', 'Opening Balance Equity', g.id, 'equity', 'credit', false, 0, true
FROM companies c
JOIN accounts g ON g.company_id = c.id AND g.code IN ('311', '3')
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE company_id = c.id AND code = '31201')
  AND NOT EXISTS (SELECT 1 FROM accounts WHERE company_id = c.id AND code = '312');

-- ============================================================
-- 3) Employee advances receivable account (11202)
--    Used as the debit side when an employee carries an opening balance.
-- ============================================================
INSERT INTO accounts (id, company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance, is_active)
SELECT gen_random_uuid(), c.id, '11202', 'سلف الموظفين', 'Employee Advances', p.id, 'asset', 'debit', false, 0, true
FROM companies c
JOIN accounts p ON p.company_id = c.id AND p.code = '112'
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE company_id = c.id AND code = '11202');

INSERT INTO accounts (id, company_id, code, name_ar, name_en, parent_id, type, nature, is_group, balance, is_active)
SELECT gen_random_uuid(), c.id, '11202', 'سلف الموظفين', 'Employee Advances', p.id, 'asset', 'debit', false, 0, true
FROM companies c
JOIN accounts p ON p.company_id = c.id AND p.code IN ('11', '1')
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE company_id = c.id AND code = '11202')
  AND NOT EXISTS (SELECT 1 FROM accounts WHERE company_id = c.id AND code = '112');

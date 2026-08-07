-- ============================================================================
-- maghzaccount-pro — Unified Schema (Baseline)
-- Version: 7 | PostgreSQL dialect
-- Generated: 2026-06-02
--
-- This file is the SINGLE source of truth for the database schema. It
-- supersedes the previous incremental migration chain (0000-0004) which
-- was rebuilt from scratch after resolving schema drift in the audit
-- columns and unique-constraint migrations.
--
-- Design principles:
--   1. Every multi-tenant table has company_id NOT NULL (multi-tenancy is
--      enforced at the schema level, not just by convention).
--   2. Every transactional table has created_by / updated_by (audit trail).
--   3. All UNIQUE constraints are declared inline (no separate DO blocks).
--   4. All DDL uses IF NOT EXISTS to be safely re-runnable.
--   5. journal_entries uses a FLAT design (no separate lines table); one
--      row = one (account, debit, credit) tuple. company_id is
--      denormalized from transactions for fast multi-tenant queries.
--   6. product_product_categories is a many-to-many join between products
--      and product_categories (composite primary key).
--   7. created_by / updated_by on most tables → ON DELETE SET NULL so a
--      deleted user does not cascade-delete their data.
-- ============================================================================

-- ============================================================================
-- § 1. CORE / AUTH
-- ============================================================================

CREATE TABLE IF NOT EXISTS "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"name_en" varchar(255),
	"currency" varchar(3) DEFAULT 'YER' NOT NULL,
	"tax_number" varchar(50),
	"address" text,
	"phone" varchar(50),
	"email" varchar(255),
	"logo_url" text,
	"date_format" varchar(20) DEFAULT 'yyyy-MM-dd',
	"decimal_places" numeric(1, 0) DEFAULT '2',
	"calendar" varchar(10) DEFAULT 'gregorian',
	"fiscal_year_start" date,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"username" varchar(100) NOT NULL,
	"email" varchar(255),
	"full_name" varchar(255),
	"phone" varchar(50),
	"password_hash" text,
	"role" varchar(50) DEFAULT 'accountant' NOT NULL,
	"branch_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_company_id_username_unique" UNIQUE ("company_id", "username")
);

CREATE TABLE IF NOT EXISTS "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"name" varchar(100) NOT NULL,
	"description" varchar(255),
	"permissions" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "roles_company_id_name_unique" UNIQUE ("company_id", "name")
);

CREATE TABLE IF NOT EXISTS "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"key" varchar(100) NOT NULL,
	"value" text,
	"category" varchar(50) DEFAULT 'general' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "settings_company_id_key_unique" UNIQUE ("company_id", "key")
);

CREATE TABLE IF NOT EXISTS "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"name" varchar(100) NOT NULL,
	"code" varchar(20),
	"address" text,
	"city" varchar(100),
	"phone" varchar(50),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "branches_company_id_code_unique" UNIQUE ("company_id", "code")
);

CREATE TABLE IF NOT EXISTS "currencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"code" varchar(3) NOT NULL,
	"name" varchar(50) NOT NULL,
	"symbol" varchar(10),
	"exchange_rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "currencies_company_id_code_unique" UNIQUE ("company_id", "code")
);

CREATE TABLE IF NOT EXISTS "vat_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"name" varchar(100) DEFAULT 'ضريبة القيمة المضافة',
	"account_id" uuid,
	"vat_rate" numeric(5, 2) DEFAULT '15' NOT NULL,
	"vat_number" varchar(50),
	"is_inclusive" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "vat_settings_company_id_unique" UNIQUE ("company_id")
);

-- ============================================================================
-- § 2. ACCOUNTING
-- ============================================================================

CREATE TABLE IF NOT EXISTS "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"code" varchar(20) NOT NULL,
	"name_ar" varchar(255) NOT NULL,
	"name_en" varchar(255),
	"parent_id" uuid,
	"type" varchar(20) NOT NULL,
	"nature" varchar(10) NOT NULL,
	"is_group" boolean DEFAULT false NOT NULL,
	"balance" numeric(18, 4) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "accounts_company_id_code_unique" UNIQUE ("company_id", "code")
);

CREATE TABLE IF NOT EXISTS "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"date" timestamp with time zone NOT NULL,
	"reference" varchar(100),
	"description" text,
	"total_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);

-- Flat design: one row per (transaction, account, debit/credit) tuple.
-- company_id is denormalized from transactions for fast multi-tenant filtering.
CREATE TABLE IF NOT EXISTS "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"transaction_id" uuid NOT NULL REFERENCES "transactions"("id") ON DELETE CASCADE,
	"account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE RESTRICT,
	"debit" numeric(18, 4) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 4) DEFAULT '0' NOT NULL,
	"memo" text,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);

-- ============================================================================
-- § 3. INVENTORY
-- ============================================================================

CREATE TABLE IF NOT EXISTS "product_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"name" varchar(100) NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "product_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"code" varchar(20),
	"name_ar" varchar(100) NOT NULL,
	"name_en" varchar(100),
	"appears_in_sales" boolean DEFAULT true NOT NULL,
	"appears_in_purchases" boolean DEFAULT true NOT NULL,
	"appears_in_inventory" boolean DEFAULT true NOT NULL,
	"appears_in_manufacturing" boolean DEFAULT false NOT NULL,
	"has_stock_tracking" boolean DEFAULT true NOT NULL,
	"has_bom" boolean DEFAULT false NOT NULL,
	"default_sales_account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
	"default_cogs_account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
	"default_inventory_account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "product_types_company_id_code_unique" UNIQUE ("company_id", "code")
);

CREATE TABLE IF NOT EXISTS "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"code" varchar(50) NOT NULL,
	"name_ar" varchar(255) NOT NULL,
	"name_en" varchar(255),
	"barcode" varchar(100),
	"sku" varchar(100),
	"unit" varchar(50) DEFAULT 'piece' NOT NULL,
	"category_id" uuid,
	"product_type_id" uuid REFERENCES "product_types"("id") ON DELETE SET NULL,
	"cost_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"sale_price" numeric(18, 4) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "products_company_id_code_unique" UNIQUE ("company_id", "code")
);

-- Many-to-many join: a product can belong to multiple categories.
CREATE TABLE IF NOT EXISTS "product_product_categories" (
	"product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
	"category_id" uuid NOT NULL REFERENCES "product_categories"("id") ON DELETE CASCADE,
	PRIMARY KEY ("product_id", "category_id")
);

CREATE TABLE IF NOT EXISTS "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"name" varchar(100) NOT NULL,
	"code" varchar(20),
	"branch_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "warehouses_company_id_code_unique" UNIQUE ("company_id", "code")
);

CREATE TABLE IF NOT EXISTS "stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
	"warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE CASCADE,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"min_stock_alert" numeric(18, 4),
	"updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
	"warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE CASCADE,
	"type" varchar(20) NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"reference" varchar(100),
	"notes" text,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "warehouse_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"from_warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
	"to_warehouse_id" uuid NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
	"status" varchar(20) DEFAULT 'pending',
	"notes" text,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "warehouse_transfer_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL REFERENCES "warehouse_transfers"("id") ON DELETE CASCADE,
	"product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
	"quantity" numeric(18, 4) NOT NULL
);

CREATE TABLE IF NOT EXISTS "stock_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"date" date NOT NULL,
	"product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
	"warehouse_id" uuid REFERENCES "warehouses"("id") ON DELETE RESTRICT,
	"system_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"actual_qty" numeric(18, 4) DEFAULT '0' NOT NULL,
	"difference" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_cost" numeric(18, 4) DEFAULT '0',
	"reason" text,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"approved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"approved_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_stock_adjustments_company_id" ON "stock_adjustments" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_stock_adjustments_product_id" ON "stock_adjustments" ("product_id");
CREATE INDEX IF NOT EXISTS "idx_stock_adjustments_status" ON "stock_adjustments" ("status");

-- ============================================================================
-- § 4. SALES
-- ============================================================================

CREATE TABLE IF NOT EXISTS "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"code" varchar(50),
	"name" varchar(255) NOT NULL,
	"phone" varchar(50),
	"email" varchar(255),
	"address" text,
	"tax_number" varchar(50),
	"credit_limit" numeric(18, 4),
	"balance" numeric(18, 4) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "customers_company_id_code_unique" UNIQUE ("company_id", "code")
);

CREATE TABLE IF NOT EXISTS "quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"quotation_number" varchar(50) NOT NULL,
	"customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
	"date" date NOT NULL,
	"expiry_date" date,
	"total_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"status" varchar(20) DEFAULT 'open',
	"notes" text,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "quotations_company_id_quotation_number_unique" UNIQUE ("company_id", "quotation_number")
);

CREATE TABLE IF NOT EXISTS "quotation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL REFERENCES "quotations"("id") ON DELETE CASCADE,
	"product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0',
	"line_total" numeric(18, 4) NOT NULL
);

CREATE TABLE IF NOT EXISTS "sales_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"invoice_number" varchar(50) NOT NULL,
	"customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
	"date" date NOT NULL,
	"due_date" date,
	"subtotal" numeric(18, 4) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(18, 4) DEFAULT '0',
	"vat_amount" numeric(18, 4) DEFAULT '0',
	"total_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(18, 4) DEFAULT '0',
	"status" varchar(20) DEFAULT 'draft',
	"notes" text,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "sales_invoices_company_id_invoice_number_unique" UNIQUE ("company_id", "invoice_number")
);

CREATE TABLE IF NOT EXISTS "sales_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL REFERENCES "sales_invoices"("id") ON DELETE CASCADE,
	"product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0',
	"vat_percent" numeric(5, 2) DEFAULT '15',
	"line_total" numeric(18, 4) NOT NULL
);

CREATE TABLE IF NOT EXISTS "sales_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"return_number" varchar(50) NOT NULL,
	"invoice_id" uuid REFERENCES "sales_invoices"("id") ON DELETE SET NULL,
	"customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
	"date" date NOT NULL,
	"subtotal" numeric(18, 4) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(18, 4) DEFAULT '0',
	"total_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"reason" text,
	"status" varchar(20) DEFAULT 'draft',
	"notes" text,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "sales_returns_company_id_return_number_unique" UNIQUE ("company_id", "return_number")
);

CREATE TABLE IF NOT EXISTS "sales_return_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL REFERENCES "sales_returns"("id") ON DELETE CASCADE,
	"product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"line_total" numeric(18, 4) NOT NULL
);

-- ============================================================================
-- § 5. PURCHASES
-- ============================================================================

CREATE TABLE IF NOT EXISTS "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"code" varchar(50),
	"name" varchar(255) NOT NULL,
	"phone" varchar(50),
	"email" varchar(255),
	"address" text,
	"tax_number" varchar(50),
	"balance" numeric(18, 4) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "suppliers_company_id_code_unique" UNIQUE ("company_id", "code")
);

CREATE TABLE IF NOT EXISTS "purchase_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"invoice_number" varchar(50) NOT NULL,
	"supplier_id" uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
	"date" date NOT NULL,
	"due_date" date,
	"subtotal" numeric(18, 4) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(18, 4) DEFAULT '0',
	"vat_amount" numeric(18, 4) DEFAULT '0',
	"total_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(18, 4) DEFAULT '0',
	"status" varchar(20) DEFAULT 'draft',
	"notes" text,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "purchase_invoices_company_id_invoice_number_unique" UNIQUE ("company_id", "invoice_number")
);

CREATE TABLE IF NOT EXISTS "purchase_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL REFERENCES "purchase_invoices"("id") ON DELETE CASCADE,
	"product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
	"description" text,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"line_total" numeric(18, 4) NOT NULL
);

CREATE TABLE IF NOT EXISTS "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"order_number" varchar(50) NOT NULL,
	"supplier_id" uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
	"date" date NOT NULL,
	"expected_date" date,
	"total_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"status" varchar(20) DEFAULT 'draft',
	"notes" text,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "purchase_orders_company_id_order_number_unique" UNIQUE ("company_id", "order_number")
);

CREATE TABLE IF NOT EXISTS "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL REFERENCES "purchase_orders"("id") ON DELETE CASCADE,
	"product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"line_total" numeric(18, 4) NOT NULL
);

CREATE TABLE IF NOT EXISTS "purchase_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"return_number" varchar(50) NOT NULL,
	"invoice_id" uuid REFERENCES "purchase_invoices"("id") ON DELETE SET NULL,
	"supplier_id" uuid NOT NULL REFERENCES "suppliers"("id") ON DELETE RESTRICT,
	"date" date NOT NULL,
	"subtotal" numeric(18, 4) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(18, 4) DEFAULT '0',
	"total_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"reason" text,
	"status" varchar(20) DEFAULT 'draft',
	"notes" text,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "purchase_returns_company_id_return_number_unique" UNIQUE ("company_id", "return_number")
);

CREATE TABLE IF NOT EXISTS "purchase_return_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"return_id" uuid NOT NULL REFERENCES "purchase_returns"("id") ON DELETE CASCADE,
	"product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_price" numeric(18, 4) NOT NULL,
	"line_total" numeric(18, 4) NOT NULL
);

-- ============================================================================
-- § 6. MANUFACTURING
-- ============================================================================

CREATE TABLE IF NOT EXISTS "boms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
	"version" varchar(20) DEFAULT '1.0',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "bom_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bom_id" uuid NOT NULL REFERENCES "boms"("id") ON DELETE CASCADE,
	"material_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
	"quantity" numeric(18, 4) NOT NULL,
	"unit_cost" numeric(18, 4) DEFAULT '0'
);

CREATE TABLE IF NOT EXISTS "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"order_number" varchar(50) NOT NULL,
	"product_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
	"bom_id" uuid REFERENCES "boms"("id") ON DELETE SET NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"produced_quantity" numeric(18, 4) DEFAULT '0',
	"status" varchar(20) DEFAULT 'planned',
	"planned_start_date" date,
	"planned_end_date" date,
	"actual_start_date" date,
	"actual_end_date" date,
	"total_cost" numeric(18, 4) DEFAULT '0',
	"notes" text,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "work_orders_company_id_order_number_unique" UNIQUE ("company_id", "order_number")
);

CREATE TABLE IF NOT EXISTS "work_order_consumptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_order_id" uuid NOT NULL REFERENCES "work_orders"("id") ON DELETE CASCADE,
	"material_id" uuid NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT,
	"planned_quantity" numeric(18, 4) NOT NULL,
	"actual_quantity" numeric(18, 4) DEFAULT '0',
	"unit_cost" numeric(18, 4) DEFAULT '0'
);

-- ============================================================================
-- § 7. HUMAN RESOURCES
-- ============================================================================

CREATE TABLE IF NOT EXISTS "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"name" varchar(100) NOT NULL,
	"manager_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "departments_company_id_name_unique" UNIQUE ("company_id", "name")
);

CREATE TABLE IF NOT EXISTS "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"employee_number" varchar(50) NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"national_id" varchar(50),
	"phone" varchar(50),
	"email" varchar(255),
	"address" text,
	"department_id" uuid,
	"position" varchar(100),
	"grade" varchar(50),
	"hire_date" date NOT NULL,
	"termination_date" date,
	"base_salary" numeric(18, 4) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "employees_company_id_employee_number_unique" UNIQUE ("company_id", "employee_number")
);

CREATE TABLE IF NOT EXISTS "attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
	"date" date NOT NULL,
	"check_in" timestamp NOT NULL,
	"check_out" timestamp,
	"overtime_hours" numeric(5, 2) DEFAULT '0',
	"notes" text,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "leaves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
	"type" varchar(50) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" numeric(5, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"total_amount" numeric(18, 4) DEFAULT '0' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "payroll_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_run_id" uuid NOT NULL REFERENCES "payroll_runs"("id") ON DELETE CASCADE,
	"employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE RESTRICT,
	"base_salary" numeric(18, 4) NOT NULL,
	"allowances" numeric(18, 4) DEFAULT '0',
	"deductions" numeric(18, 4) DEFAULT '0',
	"overtime" numeric(18, 4) DEFAULT '0',
	"net_salary" numeric(18, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "end_of_service" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"employee_id" uuid NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
	"termination_date" date NOT NULL,
	"service_years" numeric(5, 2) NOT NULL,
	"last_salary" numeric(18, 4) NOT NULL,
	"eos_amount" numeric(18, 4) NOT NULL,
	"reason" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "payroll_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"code" varchar(20),
	"name_ar" varchar(100) NOT NULL,
	"name_en" varchar(100),
	"type" varchar(20) DEFAULT 'earning' NOT NULL,
	"calculation_method" varchar(50) DEFAULT 'fixed',
	"default_amount" numeric(18, 4) DEFAULT '0',
	"affects_gross_salary" boolean DEFAULT true NOT NULL,
	"affects_tax" boolean DEFAULT false NOT NULL,
	"affects_social_insurance" boolean DEFAULT false NOT NULL,
	"default_account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "payroll_components_company_id_code_unique" UNIQUE ("company_id", "code")
);

-- ============================================================================
-- § 8. CRM
-- ============================================================================

CREATE TABLE IF NOT EXISTS "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"name" varchar(255) NOT NULL,
	"phone" varchar(50),
	"email" varchar(255),
	"company" varchar(255),
	"source" varchar(100),
	"status" varchar(20) DEFAULT 'new' NOT NULL,
	"estimated_value" numeric(18, 4),
	"assigned_to" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"notes" text,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"lead_id" uuid REFERENCES "leads"("id") ON DELETE SET NULL,
	"customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
	"name" varchar(255) NOT NULL,
	"value" numeric(18, 4) NOT NULL,
	"stage" varchar(50) DEFAULT 'prospecting' NOT NULL,
	"probability" integer DEFAULT 50,
	"expected_close_date" date,
	"assigned_to" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "crm_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"opportunity_id" uuid REFERENCES "opportunities"("id") ON DELETE CASCADE,
	"lead_id" uuid REFERENCES "leads"("id") ON DELETE CASCADE,
	"title" varchar(255) NOT NULL,
	"description" text,
	"due_date" date NOT NULL,
	"priority" varchar(20) DEFAULT 'medium' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"assigned_to" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"lead_id" uuid REFERENCES "leads"("id") ON DELETE SET NULL,
	"opportunity_id" uuid REFERENCES "opportunities"("id") ON DELETE SET NULL,
	"customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
	"type" varchar(20) NOT NULL,
	"duration" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"opportunity_id" uuid REFERENCES "opportunities"("id") ON DELETE CASCADE,
	"lead_id" uuid REFERENCES "leads"("id") ON DELETE CASCADE,
	"customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"due_date" date NOT NULL,
	"priority" varchar(20) DEFAULT 'medium' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"assigned_to" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"lead_id" uuid REFERENCES "leads"("id") ON DELETE CASCADE,
	"opportunity_id" uuid REFERENCES "opportunities"("id") ON DELETE CASCADE,
	"customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
	"type" varchar(50) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"description" text,
	"activity_date" timestamp with time zone NOT NULL,
	"duration_minutes" integer,
	"assigned_to" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now()
);

-- ============================================================================
-- § 9. SETTINGS (units, banks, cash boxes, cost centers, document sequences)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"code" varchar(20),
	"name_ar" varchar(50) NOT NULL,
	"name_en" varchar(50),
	"conversion_factor" numeric(18, 6) DEFAULT '1' NOT NULL,
	"base_unit_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "units_company_id_code_unique" UNIQUE ("company_id", "code")
);

CREATE TABLE IF NOT EXISTS "cash_boxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"name" varchar(100) NOT NULL,
	"code" varchar(20),
	"account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
	"branch_id" uuid,
	"responsible_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"current_balance" numeric(18, 4) DEFAULT '0' NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "banks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"name" varchar(100) NOT NULL,
	"bank_name" varchar(100),
	"account_number" varchar(50),
	"iban" varchar(50),
	"account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
	"branch_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"current_balance" numeric(18, 4) DEFAULT '0' NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "cost_centers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"code" varchar(20),
	"name_ar" varchar(100) NOT NULL,
	"name_en" varchar(100),
	"parent_id" uuid,
	"type" varchar(20) DEFAULT 'branch' NOT NULL,
	"budget_amount" numeric(18, 4) DEFAULT '0',
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "cost_centers_company_id_code_unique" UNIQUE ("company_id", "code")
);

CREATE TABLE IF NOT EXISTS "default_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"function_key" varchar(50) NOT NULL,
	"account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "default_accounts_company_id_function_key_unique" UNIQUE ("company_id", "function_key")
);

CREATE TABLE IF NOT EXISTS "document_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"document_type" varchar(50) NOT NULL,
	"prefix" varchar(30) DEFAULT '' NOT NULL,
	"suffix" varchar(30) DEFAULT '' NOT NULL,
	"starting_number" integer DEFAULT 1 NOT NULL,
	"current_number" integer DEFAULT 1 NOT NULL,
	"increment_step" integer DEFAULT 1 NOT NULL,
	"padding_length" integer DEFAULT 4 NOT NULL,
	"year_reset" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "document_sequences_company_id_document_type_unique" UNIQUE ("company_id", "document_type")
);

-- ============================================================================
-- § 10. VOUCHERS (Receipts and Payments)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "receipt_vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"voucher_number" varchar(50) NOT NULL,
	"date" date NOT NULL,
	"customer_id" uuid REFERENCES "customers"("id") ON DELETE SET NULL,
	"amount" numeric(18, 4) NOT NULL,
	"payment_method" varchar(20) DEFAULT 'cash' NOT NULL,
	"bank_account_id" uuid REFERENCES "banks"("id") ON DELETE SET NULL,
	"check_number" varchar(50),
	"check_date" date,
	"notes" text,
	"status" varchar(20) DEFAULT 'draft',
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "receipt_vouchers_company_id_voucher_number_unique" UNIQUE ("company_id", "voucher_number")
);

CREATE TABLE IF NOT EXISTS "payment_vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"voucher_number" varchar(50) NOT NULL,
	"date" date NOT NULL,
	"supplier_id" uuid REFERENCES "suppliers"("id") ON DELETE SET NULL,
	"expense_account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL,
	"amount" numeric(18, 4) NOT NULL,
	"payment_method" varchar(20) DEFAULT 'cash' NOT NULL,
	"bank_account_id" uuid REFERENCES "banks"("id") ON DELETE SET NULL,
	"check_number" varchar(50),
	"check_date" date,
	"notes" text,
	"status" varchar(20) DEFAULT 'draft',
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "payment_vouchers_company_id_voucher_number_unique" UNIQUE ("company_id", "voucher_number")
);

-- ============================================================================
-- § 11. AUDIT INDEXES (performance for multi-tenant queries)
-- ============================================================================

CREATE INDEX IF NOT EXISTS "idx_accounts_created_by" ON "accounts" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_transactions_created_by" ON "transactions" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_journal_entries_created_by" ON "journal_entries" ("transaction_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_journal_entries_company_id" ON "journal_entries" ("company_id", "account_id");
CREATE INDEX IF NOT EXISTS "idx_products_created_by" ON "products" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_products_product_type_id" ON "products" ("company_id", "product_type_id");
CREATE INDEX IF NOT EXISTS "idx_ppc_product_id" ON "product_product_categories" ("product_id");
CREATE INDEX IF NOT EXISTS "idx_ppc_category_id" ON "product_product_categories" ("category_id");
CREATE INDEX IF NOT EXISTS "idx_stock_movements_created_by" ON "stock_movements" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_warehouse_transfers_created_by" ON "warehouse_transfers" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_customers_created_by" ON "customers" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_quotations_created_by" ON "quotations" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_sales_invoices_created_by" ON "sales_invoices" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_sales_returns_created_by" ON "sales_returns" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_suppliers_created_by" ON "suppliers" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_purchase_invoices_created_by" ON "purchase_invoices" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_purchase_orders_created_by" ON "purchase_orders" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_purchase_returns_created_by" ON "purchase_returns" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_boms_created_by" ON "boms" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_work_orders_created_by" ON "work_orders" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_employees_created_by" ON "employees" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_attendance_created_by" ON "attendance" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_leaves_created_by" ON "leaves" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_payroll_runs_created_by" ON "payroll_runs" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_end_of_service_created_by" ON "end_of_service" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_leads_created_by" ON "leads" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_opportunities_created_by" ON "opportunities" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_crm_activities_created_by" ON "crm_activities" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_receipt_vouchers_created_by" ON "receipt_vouchers" ("company_id", "created_by");
CREATE INDEX IF NOT EXISTS "idx_payment_vouchers_created_by" ON "payment_vouchers" ("company_id", "created_by");

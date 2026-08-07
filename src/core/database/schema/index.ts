// ─── maghzaccount-pro Database Schema Aggregation ─────────────────────────────
// هذا الملف يجمع كل الجداول من كل الوحدات ويُعيد تصديرها
// يُستخدم كـ Entry Point لـ Drizzle ORM

// Core (Companies, Users, Roles, Settings, Branches, Currencies, VAT)
export * from './core';

// Accounting (Accounts, Transactions, Journal Entries)
export * from './accounting';

// Inventory (Products, Warehouses, Stock, Movements)
export * from './inventory';

// Sales (Customers, Invoices, Quotations)
export * from './sales';

// Purchases (Suppliers, Purchase Invoices, Orders)
export * from './purchases';

// Manufacturing (BOMs, Work Orders)
export * from './manufacturing';

// HR (Employees, Attendance, Payroll)
export * from './hr';

// CRM (Leads, Opportunities, Tasks)
export * from './crm';

// Vouchers (Receipts and Payments)
export * from './vouchers';

// Settings (Document Sequences, Product Types, Units, Default Accounts)
export * from './settings';

// Audit Logs
export * from './audit';

// AI Chat Persistence
export * from './ai';

// Relations (if defined separately)
// export * from './relations';

# System Overview — MaghzAccountPro

> A complete ERP accounting system for small and medium businesses in the Arab world, running on the desktop with an Arabic-first interface.

## What is MaghzAccountPro?

MaghzAccountPro is an Enterprise Resource Planning (ERP) system that covers the full accounting and business cycle: from the sales invoice to the financial statements. It is designed specifically for small and medium businesses in the Arab world, and provides:

- **IFRS-compliant double-entry accounting:** every transaction automatically creates a balanced Journal Entry.
- **Value Added Tax (VAT):** a flexible rate adjustable from Settings, calculated automatically on invoices.
- **Multi-currency:** the Base Currency is the Yemeni Rial (YER) by default, with support for other currencies (SAR / USD / AED / KWD / QAR).
- **Ready-made Chart of Accounts:** you don't need to build the tree from scratch — the system provides it during setup.
- **Smart reports:** Trial Balance, Balance Sheet (Statement of Financial Position), Income Statement, Cash Flow Statement, and analytics for every module.
- **Security and permissions:** a role-based access control (RBAC) system that governs what each user sees.

## The Thirteen Modules

| # | Module | What it gives you |
|---|--------|----------------|
| 1 | **Core** | System setup, company data, backups, database settings |
| 2 | **Authentication** | Users, roles, permissions, Audit Log |
| 3 | **Settings** | Company data, themes, currencies, VAT, branches, document sequences, default accounts |
| 4 | **Accounting** | Chart of Accounts, Journal Entries, Receipt Vouchers and Payment Vouchers, financial statements |
| 5 | **Inventory** | Products, warehouses, stock movements, adjustments, inventory valuation |
| 6 | **Sales** | Sales invoices, customers, quotations, sales returns |
| 7 | **Purchases** | Purchase invoices, suppliers, purchase orders, purchase returns |
| 8 | **Manufacturing** | BOM (Bill of Materials), Work Orders, cost and variance analysis |
| 9 | **HR** | Employees, attendance, payroll, leave, end of service |
| 10 | **CRM** | Leads, opportunities, tasks, activities |
| 11 | **Reports** | Reports Hub and sales, inventory, and profit analytics |
| 12 | **"Maghz" AI Assistant** | A smart assistant that answers your questions and performs tasks inside the system |
| 13 | **POS (Point of Sale)** | A fast cashier screen, Shifts (open/close/Z Report), cash, credit, and mixed payment |

## Essential Accounting Concepts (For Non-Accountants)

You don't need to be an accountant to use the system, but understanding these four concepts will make you confident on every screen.

### 1. Double-Entry

Every financial transaction in the system has two always-equal sides: **Debit** and **Credit**. Picture a two-pan scale — whatever goes on one pan must be balanced by something on the other.

Example: when you sell goods worth 17,250 rials, two things happen at the same time:
- Your receivable from the customer (Accounts Receivable) increases by 17,250
- Sales revenue of 15,000 + VAT payable of 2,250 is recognized

Total Debit = Total Credit = 17,250, always. This is why an amount can never "get lost" between screens — if the balance breaks, the system refuses to post.

### 2. Debit and Credit — In Simple Terms

The words "Debit" and "Credit" do not mean "increase" and "decrease"; their meaning depends on the account type:

| Account type | Examples | When does it increase? (Debit) | When does it decrease? (Credit) |
|---|---|---|---|
| **Assets** | Cash, Accounts Receivable, inventory | When something enters it (cash received, a customer owes you) | When something leaves it (cash paid out, collecting from a customer) |
| **Liabilities** | Accounts Payable, VAT payable | When they decrease (paying a supplier) | When they increase (credit purchase, VAT on an invoice) |
| **Revenue** | Sales | Returns and corrections | When revenue is earned (a sales invoice) |
| **Expenses** | Salaries, rent, electricity | When an expense is incurred | Corrections and returns |

A practical rule: **Assets and Expenses increase with Debit; Liabilities and Revenue increase with Credit.** The system applies this automatically when posting documents — you will rarely need to write a Journal Entry manually except for adjustments.

### 3. Draft vs Post

| Status | Meaning | What can you do? |
|---|---|---|
| **Draft** | The document is saved but **not yet recorded in the books** — it has no effect on accounts or inventory | Edit everything, delete, then post |
| **Posted** | The document is officially recorded — the Journal Entry is created and inventory is moved | No editing of amounts — correction is done with a reversing document (such as a return) |

The golden rule: **Posting (Post) is what creates the accounting entry.** An invoice in Draft does not appear in the Trial Balance, does not affect the customer's balance, and does not remove quantity from inventory.

### 4. Cash vs Credit Payment

| Payment type | What happens instantly? | Its effect later |
|---|---|---|
| **Cash** | The amount enters the cash box immediately with the invoice | No outstanding balance on the customer |
| **Credit** | The invoice increases the customer's balance in the **Accounts Receivable** account | You collect the amount later with a **Receipt Voucher** |
| **Mixed** (partial payments) | Part enters the cash box and the rest increases the customer's balance | You collect the remainder with a Receipt Voucher |

A **Receipt Voucher** is the document that records your collection of an amount from a customer, and a **Payment Voucher** records paying an amount to a supplier or for an expense. Each creates a Journal Entry when posted.

## "Where Do I Find It?" Table

| Daily task | Module | Path |
|---|---|---|
| I sell over the counter and want to issue a quick invoice | POS | Sidebar ← POS ← Cashier screen |
| I issue a credit sales invoice | Sales | Sidebar ← Sales ← Sales Invoices |
| I collected an amount from a customer | Accounting | Sidebar ← Accounting ← Receipt Vouchers |
| I paid a supplier or settled an expense | Accounting | Sidebar ← Accounting ← Payment Vouchers |
| I bought goods and want to enter them into inventory | Purchases | Sidebar ← Purchases ← Purchase Invoices |
| I added a new product | Inventory | Sidebar ← Inventory ← Products |
| I want to know a product's stock balance | Inventory | Sidebar ← Inventory ← Stock |
| I want to know who hasn't paid me | Reports | Sidebar ← Reports ← Customer Statement |
| I want to know who I owe | Reports | Sidebar ← Reports ← Supplier Statement |
| I want this month's profitability | Accounting | Sidebar ← Accounting ← Income Statement |
| I want to set an employee's salary | HR | Sidebar ← HR ← Payroll |
| I added a new user or edited permissions | Settings | Sidebar ← Settings ← Users / Roles |
| I changed the tax rate | Settings | Sidebar ← Settings ← Value Added Tax |
| I want a backup | Core | Sidebar ← Settings ← Backup |

## The Document Lifecycle in Two Lines

Every financial document in the system (invoice, voucher, purchase order, ...) follows one path:

```
Draft  ←→  Edit and delete freely, with no accounting effect
      │  Click "Post"
      ▼
Posted  ←→  Journal Entry created + inventory moved + balances updated, no editing
```

This is why you don't need to keep a copy of the "final invoice" — the **Posted** status is the proof of record, and the Audit Log keeps track of who did what and when.

## Security and Data Isolation

| Principle | What it means for you |
|---|---|
| **Company isolation** | All data is tied to your active company — no data flows from one business to another |
| **Permissions (RBAC)** | Every sensitive operation is checked before execution: create, edit, post, delete, export |
| **Audit Log** | Logins, logouts, and sensitive operations are recorded in a reviewable Audit Log |
| **Automatic logout** | The session ends automatically after 30 minutes of inactivity |

## Language and Design

- **Arabic-first:** the interface is fully right-to-left (RTL), with the option to switch to English from the user menu.
- **Light and dark mode:** toggled from the user menu in the header.
- **Fonts:** Cairo for Arabic and Inter for English, with the option to create a custom color theme from the Themes page.
- **Document numbers:** every document has a standard prefix for easy identification: `INV-` sales invoice, `PINV-` purchase invoice, `SR-` sales return, `POS-` POS Receipt — the full table is in the glossary appendix.

## Where to Go Next?

1. **Installation:** `02-getting-started/01-installation.md`
2. **The First-Run Setup Wizard:** `02-getting-started/02-first-run-wizard.md`
3. **Your first complete workflow:** `02-getting-started/04-quick-start.md`

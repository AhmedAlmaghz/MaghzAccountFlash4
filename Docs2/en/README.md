# Complete User Guide — MaghzAccountPro

> The complete official guide to **MaghzAccountPro** (v0.15.18): an integrated ERP accounting system for small and medium businesses, with an Arabic-first interface, IFRS-compliant double-entry accounting, flexible VAT, multi-currency support, and the "Maghz" AI Assistant.

> 🌐 This guide is also available in Arabic: [الدليل بالعربية](../ar/README.md)

---

## How to Read This Guide

- **New to the system?** Start with the [System Introduction](./01-introduction/README.md), then the [Quick Start](./02-getting-started/04-quick-start.md).
- **Looking for a specific procedure?** Use the index table below or the "Where do I find…?" table in the Introduction.
- **Accounting terminology?** See the [Glossary](./99-appendix/01-glossary.md).
- **Stuck on a problem?** Check [Troubleshooting](./99-appendix/04-troubleshooting.md), then the [FAQ](./99-appendix/05-faq.md).

### Reading Paths by Role

| Role | Suggested path |
|---|---|
| **Manager / Owner** | Introduction ← Settings ← Users & Roles ← Dashboard ← Financial Reports |
| **Accountant** | Accounting (all four) ← Sales & Purchases ← Multi-Currency ← Audit Log |
| **Cashier** | Login ← POS Terminal ← Shifts ← POS Settings |
| **Warehouse Keeper** | Products ← Warehouses & Stock ← Transfers ← Adjustments |
| **Sales Representative** | Customers ← Invoices ← Quotations ← Returns ← CRM |
| **HR Officer** | HR Settings ← Employees & Attendance ← Payroll & End of Service |
| **Sales Manager (CRM)** | Leads ← Opportunities ← Tasks & Activities |

> **Note on screenshots:** the application UI is Arabic-first, so the screenshots in this guide show the Arabic interface. Wherever an on-screen element is referenced, the English label is given with the original Arabic label in parentheses on first mention — e.g. **New Invoice (فاتورة جديدة)** — so you can match the text to what you see on screen.

---

## Full Index

| Section | Contents |
|---|---|
| **[Documentation Conventions](./CONVENTIONS.md)** | Unified terminology and the approved template (for writing and maintenance) |
| **[01 — System Introduction](./01-introduction/README.md)** | Overview, the 13 modules, double-entry and Debit/Credit concepts, Draft vs. Posted, "Where do I find…?" table |
| **[02 — Getting Started](./02-getting-started/01-installation.md)** | [Installation](./02-getting-started/01-installation.md) · [First-Run Wizard](./02-getting-started/02-first-run-wizard.md) · [Login](./02-getting-started/03-login.md) · [First Full Business Cycle](./02-getting-started/04-quick-start.md) |
| **[03 — The Interface](./03-interface/README.md)** | Sidebar, header, language & appearance, profile, themes |
| **[04 — Settings](./04-settings/README.md)** | [Company](./04-settings/01-company.md) · [Branches & Currencies](./04-settings/02-branches-currencies.md) · [VAT](./04-settings/03-vat.md) · [Document Sequences](./04-settings/04-document-sequences.md) · [Types, Categories, Units & Cash Boxes](./04-settings/05-classifications.md) · [Default Accounts](./04-settings/06-default-accounts.md) · [HR Settings](./04-settings/07-hr-settings.md) · [Backup & Database](./04-settings/08-backup-database.md) |
| **[05 — Users & Roles](./05-users-roles/README.md)** | Users, roles & permissions, "My Documents Only", Audit Log |
| **[06 — Accounting](./06-accounting/README.md)** | [Chart of Accounts](./06-accounting/01-chart-of-accounts.md) · [Journal Entries](./06-accounting/02-journal-entries.md) · [Receipt & Payment Vouchers](./06-accounting/03-vouchers.md) · [Financial Reports](./06-accounting/04-financial-reports.md) |
| **[07 — Inventory](./07-inventory/README.md)** | [Products & Multi-Units](./07-inventory/01-products.md) · [Warehouses, Stock & Transfers](./07-inventory/02-warehouses-stock.md) · [Stock Adjustments](./07-inventory/03-adjustments.md) |
| **[08 — Sales](./08-sales/README.md)** | [Customers](./08-sales/01-customers.md) · [Invoices](./08-sales/02-invoices.md) · [Quotations](./08-sales/03-quotations.md) · [Sales Returns](./08-sales/04-sales-returns.md) |
| **[09 — Purchases](./09-purchases/01-suppliers.md)** | [Suppliers](./09-purchases/01-suppliers.md) · [Invoices & Purchase Orders](./09-purchases/02-invoices-orders.md) · [Purchase Returns](./09-purchases/03-purchase-returns.md) |
| **[10 — Point of Sale (POS)](./10-pos/README.md)** | [POS Terminal](./10-pos/01-terminal.md) · [Shifts & the Z Report](./10-pos/02-shifts.md) · [Settings & Reports](./10-pos/03-settings-reports.md) |
| **[11 — Manufacturing](./11-manufacturing/README.md)** | BOMs, Work Orders, production cost & Moving Weighted Average, variance analysis |
| **[12 — Human Resources](./12-hr/01-employees-attendance.md)** | [Employees, Attendance & Leaves](./12-hr/01-employees-attendance.md) · [Payroll & End of Service](./12-hr/02-payroll-eos.md) |
| **[13 — CRM](./13-crm/README.md)** | Leads, opportunities & their stages, tasks & activities |
| **[14 — Reports](./14-reports/01-dashboard.md)** | [Dashboard](./14-reports/01-dashboard.md) · [Reports Hub & Custom Report Builder](./14-reports/02-reports-hub.md) |
| **[15 — "Maghz" AI Assistant](./15-ai-assistant/README.md)** | Chat, attachments, Arabic commands, write confirmation, batch queues, setup |
| **[16 — Multi-Currency](./16-multicurrency/README.md)** | Exchange rates, Base Currency Amount, multi-currency reports |
| **[99 — Appendices](./99-appendix/01-glossary.md)** | [Glossary](./99-appendix/01-glossary.md) · [Permissions Matrix](./99-appendix/02-permissions-matrix.md) · [Keyboard Shortcuts](./99-appendix/03-shortcuts.md) · [Troubleshooting](./99-appendix/04-troubleshooting.md) · [FAQ](./99-appendix/05-faq.md) |

---

## Golden Rules Every User Must Know

1. **Draft before Post:** every financial document (invoice, voucher, journal entry, adjustment) starts as an editable, deletable **Draft**. After **Posting** it becomes immutable and generates its journal entry — corrections are made with a reversing document or new entries.
2. **Double-entry bookkeeping:** every posted operation has a balanced journal entry (Debit = Credit), and financial reports show **posted entries only**.
3. **Inventory impact is automatic:** posting a sales invoice decreases stock, posting a purchase invoice increases it, and returns and adjustments mirror that — stock is always tracked in the Base Unit.
4. **A hidden menu is not protection:** every page is protected by its permission at the URL level — what the user is not granted cannot be reached even by typing the address.
5. **Everything is logged:** sensitive actions (login, settings changes, posting, deletion) are recorded in the Audit Log with old and new values.
6. **The "Maghz" assistant never acts without your approval:** every write operation it proposes appears as a confirmation card with a clear Arabic summary — it executes only after your explicit approval.

---

*User Guide — MaghzAccountPro v0.15.18 · Generated from source-code review · Format: Markdown*

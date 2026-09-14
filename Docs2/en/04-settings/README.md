# Settings — User Guide

> Settings are the foundation every system module rests on: the company, currencies, tax, numbering, classifications, and default accounts.

## Overview

The Settings module is the starting point for any organization using **MaghzAccountPro**. Before issuing the first invoice or recording the first journal entry, the company data, currencies, tax, and default accounts must be configured, because every other module (Sales, Purchases, Inventory, HR, POS) reads its settings from here.

- **Location:** Sidebar ← Settings
- **Main page:** `/settings` opens automatically on the Company Information page
- **Every settings change is recorded in the Audit Log** with the username, the time, and the old/new values

> Who uses this module? The business owner (initial setup and the classification structure), the accountant (default accounts, tax, currencies), and the system administrator (users, database, and backup).

## Access & Permissions

All settings pages fall under the `settings.*` module permissions:

| Permission | What it grants |
|---|---|
| `settings.view` | View the settings pages |
| `settings.create` | Add new records (a currency, branch, tax type, cash box, ...) |
| `settings.edit` | Edit saved records and settings |
| `settings.delete` | Delete records and reset the setup |

| Role | Access |
|---|---|
| `super_admin` | Everything, without restrictions |
| `admin` | All settings pages |
| `manager` | View and edit according to the permissions assigned to them |
| `accountant` | View + anything accounting-related (default accounts, tax) |
| `sales_rep` / `viewer` | View only (if granted `settings.view`) |

Sensitive buttons (add/edit/delete) are hidden automatically from users without the permission — they never appear disabled.

## Settings Pages Index

| Page | Route | Permission | Guide file |
|---|---|---|---|
| Company Information | `/settings/company` | `settings.view` / `settings.edit` | `01-company.md` |
| Appearance & Themes | `/settings/themes` | `settings.view` | — (optional, no accounting impact) |
| Branches | `/settings/branches` | `settings.*` | `02-branches-currencies.md` |
| Currencies | `/settings/currencies` | `settings.*` | `02-branches-currencies.md` |
| Value Added Tax | `/settings/vat` | `settings.*` | `03-vat.md` |
| Document Sequences | `/settings/document-sequences` | `settings.view` / `settings.edit` | `04-document-sequences.md` |
| Product Types | `/settings/product-types` | `settings.*` | `05-classifications.md` |
| Product Categories | `/settings/product-categories` | `settings.*` | `05-classifications.md` |
| Units of Measure | `/settings/units` | `settings.*` | `05-classifications.md` |
| Cash Boxes | `/settings/cash-boxes` | `settings.*` | `05-classifications.md` |
| Cost Centers | `/settings/cost-centers` | `settings.*` | `05-classifications.md` |
| Default Accounts | `/settings/default-accounts` | `settings.view` / `settings.edit` | `06-default-accounts.md` |
| HR Policies | `/settings/hr-policies` | `settings.view` / `settings.edit` | `07-hr-settings.md` |
| Payroll Components | `/settings/payroll-components` | `settings.*` | `07-hr-settings.md` |
| Backup | `/settings/backup` | `settings.create` / `settings.edit` | `08-backup-database.md` |
| Database | `/settings/database` | `settings.edit` | `08-backup-database.md` |
| Reset Setup | `/settings/reset` | `settings.delete` | `08-backup-database.md` |

Other pages inside the Settings group but documented in their own standalone guides:

| Page | Route | Guide |
|---|---|---|
| Users | `/settings/users` | Users & Roles guide |
| Roles & Permissions | `/roles` | Users & Roles guide |
| Audit Log | `/audit-logs` | Audit Log appendix |
| "Maghz" AI Assistant settings | `/settings/ai` | AI Assistant guide (permission `ai.settings`) |

> **Note:** All settings pages open inside a unified shell titled "System Settings", and their access is managed from the `/settings` route through the `settings.*` module permissions (with one exception: the AI Assistant page is governed by the standalone `ai.settings` permission).

## Recommended First-Setup Order

For a new organization, follow this exact order — each step depends on the one before it:

| # | Step | Why in this order |
|---|---|---|
| 1 | **Company Information** (logo, name, calendar, decimal places) | The foundation shown on every printed document |
| 2 | **Currencies** (base YER + other currencies) | Company Information needs the default currency, and invoices need exchange rates |
| 3 | **Value Added Tax** (a 15% type + the tax account) | Invoices pull the default rate from here |
| 4 | **Document Sequences** (prefixes and starting numbers) | Invoices and vouchers draw their numbers from the sequences |
| 5 | **Product types & categories + units of measure** | Required to enter products in Inventory |
| 6 | **Cash Boxes** (link each drawer to a GL account) | POS, cash invoices, and receipt vouchers depend on them |
| 7 | **Default Accounts** (apply a trading/manufacturing/services template) | Automatic journal entry posting uses these accounts |

After completing the seven steps, create the users and roles, then start entering actual data (customers, suppliers, products).

## Important Rules

- **Audit Log:** every create/edit/delete operation in Settings is written to the Audit Log — no exceptions. Review it from: Sidebar ← Settings ← Audit Log.
- **Company isolation:** every settings record is tied to a `company_id`; if you manage more than one organization, each one has its own fully independent settings.
- **Never delete the base currency:** the currency marked as default (star) cannot be deleted, and all reports are aggregated in it.
- **Change default accounts before activity starts:** changing them after journal entries have been posted does not rewrite the old entries — the change applies to new documents only.
- **Buttons are hidden, not disabled:** what you have no permission for you simply do not see; permission requests go through the system administrator via the Roles page.

## Tips

- Start with the default accounts template that fits your business, then adjust what is needed — faster than manual linking row by row.
- Use the **Preview** button in Document Sequences before issuing invoices to confirm the final number format.
- Take a backup immediately after completing the initial setup; that gives you a "safe point" you can return to.
- Review `16-multicurrency/README.md` before dealing in any currency other than the Yemeni Rial — the exchange rate rule and the conversion formula are documented there with examples.
- Every page above has its own guide file in this folder containing field tables, numeric examples, and common errors — never start a sensitive change before reading it.
- When in doubt about the effect of any setting, try it on a demo company first, then apply it to production data.

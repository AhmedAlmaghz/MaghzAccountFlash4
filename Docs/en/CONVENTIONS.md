# Documentation Conventions — Docs/en

This file defines the unified terminology and the approved template for every file inside `Docs/en/`.
Purpose: guarantee full consistency across all parts of the English user guide.

---

## 1. Unified Terminology (use these exact terms — never substitute synonyms)

| Unified term | Usage | Notes |
|---|---|---|
| **Draft** | A document not yet posted | Editable and deletable |
| **Post / Posted / Posting** | Post / ترحيل | Posting creates the journal entry and locks editing |
| **Journal Entry** | Journal Entry | Never "double-entry lines" |
| **Receipt Voucher** | Money received from a customer | |
| **Payment Voucher** | Money paid to a supplier or for an expense | |
| **Chart of Accounts** | Chart of Accounts | |
| **Trial Balance** | Trial Balance | |
| **Balance Sheet** | Statement of Financial Position | |
| **Income Statement** | Profit & Loss | |
| **Cash Flow Statement** | Cash Flow | |
| **Account Ledger** | Account Ledger | |
| **Opening Balance** | Opening Balance | |
| **Aging** | Receivables/Payables aging | Buckets: 0–30 / 31–60 / 61–90 / 90+ days |
| **Accounts Receivable (AR)** | What customers owe us | |
| **Accounts Payable (AP)** | What we owe suppliers | |
| **Work In Progress (WIP)** | WIP inventory account | Used in Manufacturing |
| **Moving Weighted Average** | Inventory costing method applied when a work order completes | |
| **Base Unit** | Stock is always stored in it | |
| **Conversion Factor** | Example: 1 carton = 12 base units | |
| **BOM (Bill of Materials)** | The product's manufacturing recipe | |
| **Work Order** | Work Order | |
| **Batch** | Number of times a BOM is executed | Output = Batches × BOM output quantity |
| **Shift** | In POS | |
| **Z Report** | Shift-closing report | |
| **Cash Box** | Cash drawer linked to a GL account | |
| **Walk-in Customer** | Default cash customer in POS | |
| **POS Receipt** | Numbered `POS-` independently of `INV-` | |
| **Audit Log** | Records every sensitive action | |
| **"Maghz" AI Assistant** | The system's smart assistant | |
| **Reports Hub** | Reports Hub | |
| **Custom Report Builder** | Custom Report Builder | |
| **Base Currency** | Yemeni Rial (YER) by default | |
| **Base Currency Amount** | Always computed server-side | |
| **Group Account** | Balance computed from the sum of its children | |
| **Demo Data** | Demo Data | |
| **Default Data** | Chart of accounts and settings only | |

### Document Number Prefixes (keep as-is)
`INV-` sales invoice | `PINV-` purchase invoice | `QOT-` quotation | `PO-` purchase order | `SR-` sales return | `PR-` purchase return | `ADJ-` stock adjustment | `TRF-` stock transfer | `POS-` POS receipt | `WO-` work order | `CUS-` customer | `PRD-` product

### Roles
`super_admin` (System Super Admin) | `admin` (Administrator) | `manager` (General Manager) | `accountant` (Accountant) | `sales_rep` (Sales Representative) | `viewer` (Viewer)

---

## 2. English UI & Screenshots

This guide is illustrated with screenshots captured from the application running in **English (LTR)**. Therefore:

1. On-screen elements are referenced by their **English label** only — e.g. **New Invoice**, **Post**, **Save and Post**.
2. Navigation paths read: **Sidebar ← Accounting ← Journal Entries**.
3. **Demo data** (customers, suppliers, products) is bilingual seed data; some data values (entity names, the YER currency symbol ر.ي, Arabic-Indic numerals in some widgets) may appear in Arabic inside screenshots. This reflects real application behavior, not a documentation gap.
4. Image alt text uses the English label, e.g. `![Sales Invoices list](./assets/sales/invoices.png)`.

---

## 3. Unified Template for Module Guide Files

```markdown
# [Module Name] — User Guide

> One-line description of the module's essence.

## Overview
What the module does, who it is for, and where to find it in the sidebar.

## Access & Permissions
- Required permission: `module.view` to view, `module.create` to add, ...
- What each role sees (table if needed).

## Screens
### [Screen Name]
- **Access:** Sidebar ← [path]
- **Purpose:** ...
- **Fields:** table (Field | Description | Required/Optional)
- **Buttons & Actions:** ...

## Document Lifecycle
Table: Status | Meaning | What you can do in it

## Step-by-Step Workflow
Numbered actions + an accounting numeric example where useful.

## Important Rules
- Accounting/operational rules, affected accounts, inventory impact.

## Common Errors & Fixes
Table: Message as shown in the system | Cause | Solution

## Tips
Short practical points.
```

---

## 4. Writing Rules

1. **Professional, plain English (en-US)** — short sentences, direct address to the user ("Click", "Select").
2. **Permission codes and technical fields** in backticks: `sales.create`.
3. **Every navigation path** written in full: "Sidebar ← Accounting ← Journal Entries".
4. **Numeric examples** use realistic amounts in Yemeni Rial, with YER as the base currency.
5. **Markdown tables** for fields, statuses, and errors — no long stacked paragraphs.
6. Never invent features that do not exist in the code; when in doubt, check the referenced source file.
7. File and folder names are English; content is English throughout.
8. Preserve the source Markdown structure exactly: heading levels, tables, blockquotes, bold, image embeds, and relative links (`../assets/...` and sibling-page links) must keep working.

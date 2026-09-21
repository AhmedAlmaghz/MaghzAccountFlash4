# Financial Controls & Operation Restrictions — User Guide

> How the system prevents errors and abuse in financial operations: segregation of duties, atomic posting, posted-record finality, period locks, audit trail, and inventory/cash gates — following global best practices.

## Overview

Every financial operation passes three gates before hitting the ledgers: **who is allowed** (permissions), **is it sound** (balance and validation), and **is it recorded and locked** (audit and periods). This chapter unifies the rules scattered across module chapters into one governance map, with applied examples.

You meet these controls at: **Sidebar ← Accounting** (`/accounting`), **Sidebar ← Users & Roles** (`/users` and `/roles`), **Accounting ← Year-End Close** (`/accounting/year-end`), and the **Audit Log** (`/audit-logs`).

## Access & Permissions

| Action | Permission |
|---|---|
| View chart, entries, vouchers, reports | `accounting.view` |
| Create account/entry/voucher (draft) | `accounting.create` |
| Edit/delete drafts only | `accounting.edit` / `accounting.delete` |
| Post (make financially effective) | `accounting.post` |
| Year-end close and asset depreciation | `accounting.post` (same posting permission) |
| Own documents only | `accounting.own` |

> **Golden rule:** hiding a sidebar item is **not** protection. Every route is guarded at route level (`PermissionRoute`) — direct URL access without permission redirects to home.

### Segregation of Duties (SoD) — global best practice

| Role | Accounting access |
|---|---|
| `super_admin` / `admin` | Everything (including settings and roles) |
| `manager` | View/create/edit/**post** |
| `accountant` | View/create/edit/**post** — daily operation |
| `sales_rep` | No accounting access — creates draft invoices only via `sales.create` |
| `viewer` | Read-only |

Applied separation: the rep **creates** the draft invoice, the accountant **posts** it, the manager **locks** the period — no single person combines creation, approval, and lock.

## Controls Map — where each risk is restricted

| Risk | Control | Where in code |
|---|---|---|
| Unbalanced entry | Saving as "posted" is blocked unless debit = credit and amount > 0 (0.01 tolerance) | `accounting/api.ts` — entry create/edit/post |
| Editing history after posting | Posted records are immutable — correction via new or reversing entry | Same file + `reversal.ts` |
| Double posting race | Conditional status flip (`AND status='draft'`) + `RETURNING id` check — races return an explicit error | `postTransaction` |
| Posting into a locked period | `assertPeriodOpen` check in 8 posting paths (entries, vouchers, sales/purchase invoices and returns, payroll, POS) | `src/modules/tax/engine.ts` |
| Posting into a closed year | `assertAccountingPeriodOpen` check — a closed year (`accounting_periods.status='closed'`) rejects any new posting | `src/modules/accounting/yearEnd.ts` |
| Selling from empty stock | `checkStockSufficiency` gate — **deny is the default**; exceptional override is logged via `auditOverride` | `src/core/utils/stockPolicy.ts` |
| Paying from an empty cash box | `getCashBoxGlBalance` check (ledger balance from `SUM(je)`) at direct-post creation and at later posting | Same file via `accounting/api.ts` |
| Exceeding customer credit limit | Limit check at posting — 0 means unlimited | Same gate |
| Duplicate entry/invoice/voucher | Duplicate guard: exact match → **block**, near match → warning with similarity % | Entry, invoice, and voucher pages |
| AI writing without review | `fail-closed`: every write tool requires a confirmation card with a summary before execution | `src/modules/ai` (engine) |
| Lost change trail | `audit_logs`: every create/edit/delete/post/reversal with user, time, and values | `/audit-logs` |

## Financial Document Lifecycle

| Status | Meaning | Allowed actions |
|---|---|---|
| **Draft** | No financial effect — absent from all reports | Edit, delete, **post**, print |
| **Posted** | Generated entry, effective — in all reports | Read, print, and **reverse** only |
| **Reversed** | For vouchers: reversed by a mirror entry with status flip | Read-only — no second posting |
| **Cancelled** | Draft dropped before posting | Read-only |
| **Period/year closed** | Its period or year was locked | No new posting dated inside, ever |

## Step-by-Step Workflow — full numeric example (cash sale with tax)

The case: cash sale 100,000 YER + 15% tax = **115,000**, frozen line cost 60,000, cash box `11101`, revenue `41101`, output VAT `21301`, COGS `51101`, inventory `11301`.

1. Sidebar ← Sales ← Sales Invoices ← **"New Invoice"** (needs `sales.create`).
2. Customer: default walk-in customer, payment type: **cash**, cash box: main box (a box with no ledger account will fail posting later — pick an account-linked box).
3. Line: item at 100,000, quantity 1. The system freezes `unit_cost` at posting time, not at entry time.
4. Save as **draft** — no entry yet, no effect on the customer balance (cash never touches it).
5. Press **"Post"** (needs `sales.post` or `accounting.post` per setup). Gates run in order:
   - Tax period and fiscal year open for the invoice date?
   - Stock sufficient (or audited override)?
   - Cash-box ledger balance covers (for payments)?
6. On success everything executes **atomically** (one transaction — all or nothing):

| Entry | Account | Debit (YER) | Credit (YER) |
|---|---|---:|---:|
| Sale entry | Cash box `11101` | 115,000 | |
| | Sales revenue `41101` | | 100,000 |
| | Output VAT `21301` | | 15,000 |
| Cost entry (`-COGS`) | Cost of sales `51101` | 60,000 | |
| | Inventory `11301` | | 60,000 |

7. Result: `paid_amount = 115,000` with status **paid**, customer balance **unchanged** (cash), inventory reduced by the sold quantity.

### What if you err after posting?

You discover the right price was 90,000 + tax. The invoice is posted — edit and delete are **disabled**. The correct path:

1. Create a **sales return** for the difference (or full return then a correct invoice) — the return reverses revenue and tax on `21301` and cost at the frozen `unit_cost`.
2. For manual entries: create a **reversing entry** (`REV-` + original reference) swapping debit/credit — the original stays posted and SUM-based reports net the effect to zero.
3. For vouchers: **reversal** generates a mirror of the actual legs and flips the voucher to `reversed` — no double reversal (the guard rejects an existing `REV-`).

## Key Rules — quick summary

| Rule | Detail |
|---|---|
| `SUM(je)` is the single source of truth | Balances come from posted entries; the `balance` column is a display mirror never added to entries |
| Posted is final | No edit, no delete — reversal only, and double reversal is impossible (`REV-` guard + remainder-only) |
| Ledger in base currency | Any foreign document posts base amounts (server-computed `base_*`); differences go to a separate FX entry |
| Tax is split, not one account | Output `21301` credit-natured, input `21302` debit-natured (contra-liability) — returns read from period entry legs |
| Cost frozen at sale time | `unit_cost` is stored at posting; returns reverse the **actual** cost, never an estimate ratio |
| Lock at posting, not at entry | Drafts are free at any date; the posting moment checks tax period and fiscal year |
| Deny by default | Any unconfigured stock/credit/cash policy = **deny** — overrides are audit-logged |
| Approval before automated writes | The AI assistant shows a summary card; no approval means no execution (fail-closed) |

## Common Errors & Fixes

| Message | Cause | Fix |
|---|---|---|
| "Tax period is closed" | Document date inside a `closed/filed` period | Change posting date to an open period, or reopen with an authorized permission |
| "Fiscal year is locked" | `accounting_periods.status='closed'` for the year | Posting into a closed year is never allowed — record in the open year |
| "Insufficient stock" | Gate refused below-zero sale | Reduce quantity, transfer from another warehouse, or request an audited override |
| "Cash box balance insufficient" | Ledger (`SUM(je)`) below the amount | Fund the box with a receipt first, or switch boxes |
| "Credit limit exceeded" | Customer dues + new exceed the limit | Collect a payment first, or raise the limit on the customer card |
| "Unbalanced entry" | Debit ≠ credit | Equalize the totals (0.01 rounding tolerance) |
| "Already reversed" | `REV-` reference exists | No second reversal — review the existing reversing entry |
| "Invoice is posted — editing disabled" | Posted-record protection | Create a return for the difference instead of editing |

## Tips

- Review the "draft" filter at day end: drafts are invisible in every financial report.
- Check the "balanced" indicator in the balance sheet before/after any big posting batch.
- Never enter manually what modules generate: a posted invoice already created its entry — a manual duplicate inflates.
- Review every audited override (below-zero sale, over-balance payment) weekly from the audit log.
- A closed year is an archive: any correction belonging to it is recorded in the open year as an adjusting entry with a cross-reference.

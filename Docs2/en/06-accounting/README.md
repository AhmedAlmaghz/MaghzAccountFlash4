# Accounting Module — User Guide

> The heart of the accounting system: a double-entry-compliant Chart of Accounts, Journal Entries, Receipt and Payment Vouchers, and the four financial reports.

## Overview

The Accounting module is the reference to which all transactions flow from the other modules: a sales invoice is posted and creates a journal entry, a Receipt Voucher reduces a customer's balance, a purchase invoice raises Accounts Payable. If you are new to the system, follow the reading map below in order.

**Location:** Sidebar ← **Accounting**. The parent page `/accounting` shows navigation cards for every sub-screen:

| Screen | Path | Purpose |
|---|---|---|
| Chart of Accounts | `/accounting/chart` | The hierarchical account structure and its management |
| Journal Entries | `/accounting/journal` | Entering manual entries and posting them |
| Receipt Vouchers | `/accounting/receipt-vouchers` | Incoming funds from customers |
| Payment Vouchers | `/accounting/payment-vouchers` | Outgoing funds to suppliers and expenses |
| Account Ledger | `/accounting/ledger` | One account's transactions with a running balance |
| Trial Balance | `/accounting/trial` | The balances of all accounts up to a date |
| Balance Sheet | `/accounting/balance` | Assets versus liabilities and equity |
| Income Statement | `/accounting/profit` | Revenues, expenses, and the period's net profit |
| Cash Flow Statement | `/accounting/cashflow` | Cash movement using the indirect method |

## "Where Do I Start?" — Reading Map

1. **Chart of Accounts first** (`01-chart-of-accounts.md`): understand the hierarchy, the five types, and the debit/credit nature. Nothing else makes sense before that — every entry and voucher lands on accounts from the tree.
2. **Journal Entries second** (`02-journal-entries.md`): the core of double-entry accounting. Learn the line editor, the balance check, and the posting rules — the same ones applied inside vouchers and invoices.
3. **Receipt and Payment Vouchers third** (`03-vouchers.md`): the most frequent daily cash movement; they are essentially ready-made entries built for you automatically.
4. **Financial reports last** (`04-financial-reports.md`): Account Ledger, Trial Balance, Balance Sheet, Income Statement, and Cash Flow Statement — the fruit of everything above.

## Access & Permissions

Every screen in the module needs `accounting.view` to view. The other actions are separate:

| Permission | What it unlocks |
|---|---|
| `accounting.view` | View the tree, entries, vouchers, and all financial reports |
| `accounting.create` | Create a new account, a new entry, a new voucher |
| `accounting.edit` | Edit drafts (posted documents are locked for everyone) |
| `accounting.delete` | Delete drafts |
| `accounting.post` | **Posting** — turning a draft into a financially effective document (creates the journal entry and updates balances) |
| `accounting.own` | "My documents only" — lists are filtered to the user's own entries and vouchers |

**What each role sees:**

| Role | Access |
|---|---|
| `super_admin` / `admin` | Everything |
| `manager` (General Manager) | View/create/edit/**post** |
| `accountant` (Accountant) | View/create/edit/**post** — the role dedicated to daily accounting |
| `sales_rep` (Sales Representative) | No access to Accounting at all |
| `viewer` (Viewer) | View only — no create, edit, or posting |

## Accounting Concepts Applied in the Module

- **Double-entry accounting:** every transaction has two balanced sides — total Debit = total Credit. The system enforces this at save and post time.
- **Draft → Post:** every accounting document (entry or voucher) is created as an editable, deletable **Draft**, then **Posted** — it becomes final, uneditable, and reflected in the reports.
- **Only posted entries count:** every financial report (Trial Balance, Balance Sheet, Income Statement, Account Ledger) reads exclusively from **Posted** entries.
- **Opening Balance:** entered from the Chart of Accounts as a balanced entry through the opening equity account, so opening balances appear in the reports automatically without special handling.
- **Audit Log:** every create, edit, delete, and post is recorded in the Audit Log with the user, the time, and the old/new values.

## Files in This Section

| File | Content |
|---|---|
| `01-chart-of-accounts.md` | Chart of Accounts: the hierarchy, filters, adding an account with automatic code suggestion, the rules |
| `02-journal-entries.md` | Journal Entries: the multi-line editor, the balance check, the duplicate guard, posting rules, a numeric example |
| `03-vouchers.md` | Receipt and Payment Vouchers: fields, invoice linking, the lifecycle, numeric examples |
| `04-financial-reports.md` | Account Ledger, Trial Balance, Balance Sheet, Income Statement, Cash Flow Statement |

## Quick Access Matrix

| Screen | View | Create | Edit/Delete | Post | Export |
|---|---|---|---|---|---|
| Chart of Accounts | `accounting.view` | `accounting.create` | `accounting.edit` / `accounting.delete` | — | Excel |
| Journal Entries | `accounting.view` | `accounting.create` | `accounting.edit` / `accounting.delete` (drafts only) | `accounting.post` | Print |
| Receipt & Payment Vouchers | `accounting.view` | `accounting.create` | `accounting.edit` / `accounting.delete` (drafts only) | `accounting.post` | Print |
| Account Ledger | `accounting.view` | — | — | — | Excel + PDF |
| Trial Balance | `accounting.view` | — | — | — | Excel + PDF |
| Balance Sheet | `accounting.view` | — | — | — | Excel + PDF |
| Income Statement | `accounting.view` | — | — | — | Excel + PDF |
| Cash Flow Statement | `accounting.view` | — | — | — | — |

## How Transactions Flow Between Modules — Where Did My Movement Come From?

A strange figure in Accounting is usually caused by a document from another module. Quick tracing table:

| If you see... | It usually comes from | To fix it |
|---|---|---|
| A customer balance that doesn't match their statement | A posted sales invoice or a Receipt Voucher | Review the customer's sales invoices and receipt vouchers |
| A supplier balance that jumped suddenly | A posted purchase invoice | Review purchase invoices |
| A journal entry you did not enter manually | A module generated it: sales/purchases/POS/manufacturing/payroll | Review the source module's documents — do not try to edit its entries |
| Inventory valued differently than you expect | Stock movements and adjustments | Review Inventory ← Movements and Adjustments |

## Terms You Will Meet in This Module

| Term | Meaning here |
|---|---|
| **Draft** | An unposted document — it affects no balances and no reports |
| **Post** | Finalizing the document: creates the journal entry, updates balances, and locks editing |
| **Running Balance** | A cumulative balance in the Account Ledger: each row shows the balance immediately after it |
| **As-of date** | A point-in-time report accumulating from the beginning of the books to that day |
| **Opening Balance** | The account balance at the start of using the system — posted through the opening equity account |
| **0.01 tolerance** | The tolerance margin in balance comparisons to absorb rounding differences |

## What Is Ready at First Run?

The system does not start empty — **Default Data** is created automatically:

| Ready item | Details |
|---|---|
| A complete Chart of Accounts | Five main types with their core group and detail accounts (cash, bank, receivables, capital, revenues, expenses...) |
| System accounts | The opening equity account for Opening Balances, and module-linking accounts |
| Document sequences | Automatic numbering of entries and vouchers with no manual effort |
| Demo Data (optional) | Entries, vouchers, and invoices for practice — delete them before going live |

## Before Going Live — The Accountant's Checklist

1. Review the default Chart of Accounts, keep what fits your business, and add your own detail accounts.
2. Enter the **Opening Balance** for every detail account (cash, banks, inventory, receivables, fixed assets...) — it is posted automatically through opening equity.
3. Confirm the **"Balanced"** indicator appears in the Balance Sheet after the opening entries.
4. Try a test Receipt Voucher and Payment Voucher on dummy accounts, then delete them before going live.
5. Check the Trial Balance — total Debit must equal total Credit from the very first moment.

## Tips

- Start your day from the main accounting page `/accounting` — the cards take you straight to what you need.
- Major entry mistakes are corrected with a new **reversing entry**, not by editing — because posted documents are uneditable.
- Watch the balance indicator in the Balance Sheet after every large posting batch; "Balanced" means Assets = Liabilities + Equity in fact.

## Frequently Asked Questions

| Question | Answer |
|---|---|
| Can I edit a posted entry? | No — by design. Create a reversing entry and record it |
| Do drafts appear in reports? | No — all reports read exclusively from posted entries |
| Why can't I edit a group account's balance? | Because it is computed automatically as the sum of its children — adjust detail accounts through entries |
| Where do I see a specific customer's balance? | The customer statement in the Reports Hub, or the Account Ledger of the Accounts Receivable account |
| I entered an Opening Balance and it doesn't appear in the report | Make sure the generated opening entry was posted and is not a draft |
| How do I export a report? | The Excel or PDF button at the top of each report — it exports what you currently see, with its filters |
| Is a receipt voucher a separate entry from the entry it created? | No — when posted, the voucher **generates** its journal entry automatically; do not enter it manually |
| Who holds posting permission in my company? | Whoever holds `accounting.post` — usually the General Manager and the Accountant (see the Roles page) |
| I changed the report date and the numbers didn't change | Make sure both comparison periods actually contain posted entries — an empty period shows zeros |
| Can accounting handle more than one currency? | Yes — vouchers accept a currency and an exchange rate, and the Base Currency equivalent is stored (see the multi-currency section) |

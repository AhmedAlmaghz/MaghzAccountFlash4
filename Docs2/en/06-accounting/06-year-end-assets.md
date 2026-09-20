# Year-End Close, Fixed Assets & Reversal — User Guide

> Close the year with a `CLS-YYYY` entry, track fixed assets with mandatory capitalization and monthly depreciation, and correct posted mistakes by true reversal — never by editing history.

## Overview

Three tools protect ledger integrity over time: **year-end close** seals the year and blocks posting into it, the **asset register** capitalizes purchases and depreciates them monthly, and **reversal** corrects posted errors without touching the original. Find them at: **Sidebar ← Accounting ← Year-End Close** (`/accounting/year-end`), **Accounting ← Fixed Assets** (`/accounting/fixed-assets`), and the **"Reverse"** button on posted entries, invoices, and vouchers.

## Access & Permissions

| Action | Permission |
|---|---|
| View close, assets, reversal | `accounting.view` |
| Create asset / run monthly depreciation | `accounting.create` |
| Close the year (`CLS-YYYY`) | `accounting.post` |
| Reverse a posted entry/invoice/voucher | `accounting.post` (same posting permission) |

## Year-End Close

### Screen

- **Access:** Sidebar ← Accounting ← Year-End Close.
- **Purpose:** preview the year result (revenue, expenses, net), then close it with one system entry.
- **Fields:** fiscal year (bounds derive from the company `fiscal_year_start` setting).
- **Buttons:** "Preview" (`previewFiscalClose`) then "Close Year" (`closeFiscalYear`).

### Year lifecycle

| Status | Meaning | Allowed |
|---|---|---|
| **Open** | Posting allowed for dates inside | Normal posting + close preview |
| **Closed** | Sealed with a `CLS-YYYY` entry | No new posting dated inside, ever — corrections go to the open year |

### Step-by-step workflow — numeric example

Year 2026: revenue 12,000,000 YER and expenses 9,500,000 — net **2,500,000** profit:

1. Open year-end close, pick year `2026`, press **"Preview"** — the system shows:
   - Total revenue (posted movements on revenue accounts).
   - Total expenses.
   - Expected net to retained earnings.
2. Press **"Close Year"** — one entry with reference `CLS-2026` is posted:

| Account | Debit (YER) | Credit (YER) |
|---|---|---:|
| Revenue (closing) | 12,000,000 | |
| Expenses (closing) | | 9,500,000 |
| Retained earnings (net) | | 2,500,000 |

3. The year flips to **closed** (`accounting_periods.status='closed'`) — any later posting dated inside 2026 is **rejected with an explicit message**.
4. Guards: no closing a year that has not ended, no closing while an older year is still open, no double close (`CLS-2026` exists → "already closed" rejection).

## Fixed Assets

### Screen

- **Access:** Sidebar ← Accounting ← Fixed Assets.
- **Purpose:** register of every asset (name, `FA-` code, category, purchase date, cost, salvage value, life in months, method: straight-line/declining).
- **Status:** `active` → `disposed` — final.

### Step-by-step workflow — numeric example

Buy a delivery van for **6,000,000** YER cash, 60-month life, straight-line:

1. Press **"New Asset"** and pick funding: **cash box** — **capitalization is part of creation itself** (not a later step):

| Account | Debit (YER) | Credit (YER) |
|---|---|---:|
| Fixed assets at cost `12101` | 6,000,000 | |
| Cash box (selected treasury) | | 6,000,000 |

2. Monthly press **"Run Depreciation"** — installment = 6,000,000 ÷ 60 = **100,000**:

| Account | Debit (YER) | Credit (YER) |
|---|---|---:|
| Depreciation expense | 100,000 | |
| Accumulated depreciation `12102` (contra, credit-natured) | | 100,000 |

3. Runs are **idempotent**: same month twice never duplicates (existing `DEP-YYYYMM` reference → safe skip).
4. Disposal (sell the van for 1,000,000 after 2,000,000 accumulated depreciation):

| Account | Debit (YER) | Credit (YER) |
|---|---|---:|
| Accumulated depreciation `12102` | 2,000,000 | |
| Cash box (proceeds) | 1,000,000 | |
| Asset disposal losses | 3,000,000 | |
| Assets at cost `12101` | | 6,000,000 |

### Asset rules

| Rule | Detail |
|---|---|
| Cost and purchase date lock after first depreciation | Editing afterwards is forbidden — correct with an adjusting entry |
| Delete pristine assets only | Only an asset with no posted depreciation can be deleted |
| No future depreciation | Runs reject months after today |

## True Reversal

| Posted original | What reversal does | Effect |
|---|---|---|
| **Manual entry** | `REV-`<reference> mirror swapping Dr↔Cr | Original stays posted; SUM-based reports net the effect |
| **Sales/purchase invoice** | Real return for the **remainder only** (invoiced − previously returned per line) via real create+post | Double reversal is **mathematically impossible** — zero remainder is rejected |
| **Receipt/payment voucher** | Mirror of the **actual** entry legs (never a rebuilt estimate) + voucher status flips to `reversed` | No second reversal — the guard rejects an existing `REV-` |

### Numeric example — reversing a payment voucher

Posted payment voucher 500,000 (rent expense debit / cash credit). Reversal generates:

| Account | Debit (YER) | Credit (YER) |
|---|---|---:|
| Cash box | 500,000 | |
| Rent expense | | 500,000 |

And flips the voucher to `reversed` with its own `REV-` reference — a second attempt is rejected.

## Key Rules — quick summary

| Rule | Detail |
|---|---|
| A closed year is an archive | Any correction belonging to it is recorded in the open year as an adjusting entry with a cross-reference |
| Capitalization is part of asset creation | A record without an entry = understated assets and hidden capex — always the same atomic transaction |
| Declining depreciation never breaks salvage | The declining (DDB) method stops at salvage value and never crosses it |
| Invoice reversal = remainder only | `Remaining = invoiced − returned` per line — zero rejection prevents inflation |

## Common Errors & Fixes

| Message | Cause | Fix |
|---|---|---|
| "Already closed" / `CLS-2026` exists | Duplicate close | Nothing — the year is genuinely sealed |
| "Cannot close — a later year is closed" | Broken chronological order | Open the years in correct order first |
| "Already reversed" | `REV-` reference exists | Review the existing reversing entry |
| "Invoice fully reversed or returned" | Zero remainder on all lines | No new reversal — all lines are covered |
| "Reversal for posted only" | Attempt on a draft | Post first, or delete the draft |

## Tips

- Close the year as soon as statements are approved — every delayed day is a backdating window.
- Name assets with sequential `FA-` codes and attach photos and invoices to each record.
- Before disposal print the asset card (cost − accumulated = net) and compare with the sale price to anticipate gain/loss.

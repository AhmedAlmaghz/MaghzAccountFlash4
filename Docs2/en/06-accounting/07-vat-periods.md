# Tax Periods & VAT Return — User Guide

> Split input from output VAT, run periods through three statuses, and compute the VAT return from posted entry legs — never from invoice headers.

## Overview

The tax module separates two directions: **output VAT** (on your sales — credit `21301`) and **input VAT** (on your purchases — debit `21302` under the same 213 group). Tax periods (`tax_periods`) split the year into filing windows, each passing three statuses. Configure at: **Sidebar ← Settings ← Tax** (the VAT page includes the `VatReturnPanel`), and the tax-jurisdiction card in **Company Profile** (`TaxJurisdictionCard`).

## Access & Permissions

| Action | Permission |
|---|---|
| View tax settings and return | `settings.view` |
| Edit jurisdiction/rate/periods and file the return | `settings.edit` |
| Post inside an open period | Source-module posting permission (`sales.post` / `accounting.post` …) |

## The Two Separate Accounts

| Account | Nature | Affected by |
|---|---|---|
| Output VAT `21301` | Liability (credit) | Posted sales invoices (+), posted sales returns (−) |
| Input VAT `21302` | Contra-liability (debit under 213) | Posted purchase invoices (+), posted purchase returns (−) |

> **Why split?** One account mixes what you collect for the state with what you reclaim from it. The split makes the return a direct read: period output minus period input.

## Supported Countries (`tax.country_code` is the single rate source)

| Country | Code | Rate | Note |
|---|---|---|---|
| Saudi Arabia | `SA` | 15% | |
| UAE | `AE` | 5% | |
| Egypt | `EG` | 14% | |
| Yemen | `YE` | 0% | A true zero rate — not absence |

- Set the country on the company-profile jurisdiction card — the rate is read from the country profile, **never assumed at 15%**.
- Missing country = ask the user for their country before any tax posting, never assume silently.

## Tax Periods — lifecycle

| Status | Meaning | Allowed |
|---|---|---|
| **Open** | Accepts postings | Normal posting + return preparation |
| **Closed** | Amendment window ended | No new posting dated inside — corrections go to an open period |
| **Filed** | Its return was submitted to the state | Final — historical reference only |

**Lock at posting, not at entry:** drafts are free at any date; the posting moment runs `assertPeriodOpen` across 8 paths (entries, vouchers, sales/purchase invoices and returns, payroll, POS) and rejects a closed/filed-period date with a message naming the period.

## Step-by-Step Workflow — numeric example (monthly return)

June 2026 period (`SA` — 15%): posted sales 1,000,000 + tax 150,000, sales return 100,000 + tax 15,000, posted purchases 600,000 + tax 90,000, purchase return 60,000 + tax 9,000.

1. Sidebar ← Settings ← Tax ← **Return** panel.
2. Pick the period (June 2026) — lines compute **from posted entry legs** inside the period:

| Line | Account | Amount (YER) |
|---|---|---:|
| Period output | `SUM(credit)` on `21301` | 150,000 |
| Output returns | `SUM(debit)` on `21301` | 15,000 |
| **Net output** | | **135,000** |
| Period input | `SUM(debit)` on `21302` | 90,000 |
| Input returns | `SUM(credit)` on `21302` | 9,000 |
| **Net input** | | **81,000** |
| **VAT due** | Net output − net input | **54,000** |

3. Review every line against its entries (each line links to entries for audit), then **"Close Period"** and **"File"** — it becomes `filed` and rejects any new posting inside June.

> **Why legs, not headers?** The invoice-header `vat_amount` lies after later returns, discounts, and adjustments. Posted legs are the only audited truth.

## Key Rules — quick summary

| Rule | Detail |
|---|---|
| Returns from legs only | `SUM(je.credit) − SUM(je.debit)` on the two tax accounts for the period — never read invoice headers |
| `YE` is zero-rated, not exceptional | The engine treats it as a 0% country — no scattered `if country` branches |
| Old drafts post into the new period | A draft created long ago but posted today checks **today's** period, not its creation period |
| Close before filing | Never file an open period — close first, then file |

## Common Errors & Fixes

| Message | Cause | Fix |
|---|---|---|
| "Tax period is closed/filed" | Posting date inside a `closed/filed` period | Post with a date in an open period, or reopen with an authorized permission |
| Return differs from invoice expectations | Unposted drafts, or later returns | Compare leg lines one by one — drafts never enter the return |
| Unexpected rate on an invoice | Set country is not what you think | Check the `tax.country_code` jurisdiction card in company profile |

## Tips

- Close each period right after filing — a lingering open period invites backdated errors.
- Before closing, print the draft return and reconcile net output against posted sales-invoice tax for the period.
- Changed country? Update jurisdiction **before** any new invoice — posted invoices are never repriced retroactively.

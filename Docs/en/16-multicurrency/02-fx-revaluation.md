# Exchange Differences & Revaluation — User Guide

> Ledger always in base currency, invoices accrue at their own rate, differences go to a separate entry — with periodic revaluation anchored against duplication — per IAS 21.

## Overview

The governing rule: **documents in their language, ledger in base**. A USD invoice is displayed and printed in USD, but its entry posts in YER (server-computed `base_*`). Two difference types: **realized** (linking a voucher to an invoice at two different rates) and **unrealized** (revaluing open balances at period end). The button lives at: **Sidebar ← Settings ← Currencies** (revaluation section: date + "Run").

## Access & Permissions

| Action | Permission |
|---|---|
| View currencies and rates | `settings.view` |
| Edit exchange rates | `settings.edit` |
| Run periodic revaluation (generates an entry) | `accounting.post` |
| Post a foreign document (base auto-computed) | Source-module posting permission |

## How Amounts Are Computed

- Every foreign document carries: document amount (`total_amount`) + rate (`exchange_rate`) + **server-computed equivalent** (`base_currency_amount`).
- `splitBaseTotal` guarantees: base subtotal + base tax = **base total exactly** (rounding dust loads onto the subtotal).
- Reports aggregate in **base** (`COALESCE(base, doc)`) — adding dollar and riyal amounts together is a meaningless number.

## Realized Differences — numeric example

Sales invoice `INV-0007`: 1,000 USD at **1,500** (base due 1,500,000). The customer later pays when the rate is **1,600**, sending 1,000 USD = 1,600,000 base:

1. The voucher applies to the invoice **at the invoice rate** (1,500) — the due is fully exhausted: `base_paid += applied × invoice rate`.
2. The 100,000 difference is an FX gain (we received more base value than booked), posted as a separate `-FX` entry:

| Account | Debit (YER) | Credit (YER) |
|---|---|---:|
| Accounts receivable (difference clearing) | 100,000 | |
| Exchange differences `52902` (gain — credit) | | 100,000 |

> Direction note: receiving **less** base than booked = loss (debit `52902` / credit receivables); receiving **more** = gain (debit receivables / credit `52902`) — the code branches on the sign automatically.

3. Two guards: **currency match** (USD voucher to USD invoice — cross-currency settlement needs its own payment voucher), and the **outstanding cap** (applied never exceeds the remainder).

## Periodic Revaluation — numeric example

Open invoice `INV-U`: 1,000 USD, 800 USD still due, invoice rate 1,500, today 1,700:

1. On the Currencies page pick the valuation date (e.g. `2026-09-30`) and press **"Run"**.
2. One aggregate entry with reference `FX-20260930` posts only the incremental movement since the **last rate it was valued at** (`last_reval_rate`) — never the full gap from the invoice rate each time.
3. The invoice is stamped (`last_reval_rate = 1700`) — **a second run for the same date is a no-op** (no new entry) by proof.
4. Base-currency invoices and missing rates are **honestly skipped** (listed in the result, never guessed).

### The account

| Account | Role |
|---|---|
| Exchange differences `52902` | Realized and unrealized differences together (gains credit / losses debit) |

## Key Rules — quick summary

| Rule | Detail |
|---|---|
| Invoices accrue at their own rate | `base_paid` always uses the invoice rate — the difference is a separate FX entry, never due manipulation |
| Revaluation is incremental with an anchor | `last_reval_rate` is stamped every run — anchorless revaluation double-counts by mistake |
| Convert at aggregation, not at display | Conversion happens in SQL itself — an extra display-side conversion would double-count through the currency breakdown |
| Raw party balances mix currencies | The `balance` column mixes currencies for multi-currency parties — precision lives in the ledger (base) and aging (base) |

## Common Errors & Fixes

| Message | Cause | Fix |
|---|---|---|
| "Voucher currency mismatches invoice currency" | Linking USD to YER | Settle in the invoice currency, or create a separate payment voucher for the gap |
| "Applied amount exceeds outstanding" | Payment above the remainder | Lower applied to the remainder; excess stays on-account |
| Revaluation produced zero entries | All invoices are base-currency or already valued at the same rate | Normal — the second run is a no-op by design |

## Tips

- Revalue at each month end before closing the tax period — differences belong to the period result.
- Never edit a posted invoice's `exchange_rate` to fix an FX gap — the gap is an `-FX` entry, not a rate correction.
- Review `52902` after each revaluation: a debit balance = losses, a credit = period gains.

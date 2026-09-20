# Inventory Valuation Methods — User Guide

> Three company-level valuation methods (Moving Average, FIFO, Standard with price variance), and true cost of sales instead of estimates — per IAS 2.

## Overview

The valuation method determines **cost of goods sold** and therefore the gross margin on the income statement. The system supports three methods per company, set at: **Sidebar ← Settings ← Company** (inventory policy card, key `inventory.valuation_method`). The item standard cost is entered on the **product card** (field `standard_cost`).

## Access & Permissions

| Action | Permission |
|---|---|
| View valuation policy and valuation report | `inventory.view` |
| Change valuation method and standard cost | `inventory.edit` (company policy needs `settings.edit`) |
| Post invoices, returns, adjustments (method applies automatically) | Source-module posting permission |

## The Three Methods

| Method | Key | How cost is computed | Fits you when |
|---|---|---|---|
| **Moving average** (default) | `moving_average` | Every purchase blends: new average = (old value + purchase value) ÷ (old qty + purchase qty) | Volatile purchase prices without batch tracking |
| **First-in first-out** (FIFO) | `fifo` | Every receipt opens a **layer** (`inventory_layers` with date and cost); issues consume oldest first | Expiry-dated goods or distinctly priced batches |
| **Standard with variance** | `standard` | Cost is always the frozen `standard_cost`; the gap between actual purchase and standard goes to **Purchase Price Variance** `51901` | Manufacturing with fixed budget standards |

### Accounts involved

| Account | Role |
|---|---|
| Inventory `11301` | Stock value at the chosen cost |
| Purchase Price Variance `51901` | Receives the actual-vs-standard gap (standard method only) |
| Inventory Shortage `52901` / Surplus `41901` | Adjustments at current cost (`\|diff\| × cost`) — never a silent plug into COGS |
| Cost of sales `51101` | Frozen on the invoice line (`unit_cost`) at posting time |

## Step-by-Step Workflow — numeric example (FIFO)

Item "Sugar 50kg" with zero balance. Method: `fifo`:

1. **First purchase:** posted purchase invoice — 100 units × 1,000 = 100,000. **Layer 1** opens (100 @ 1,000).
2. **Second purchase:** posted invoice — 100 units × 1,200 = 120,000. **Layer 2** opens (100 @ 1,200).
3. **Sale:** posted sales invoice — 150 units. Consumption eats oldest first:
   - 100 from layer 1 × 1,000 = 100,000 (exhausted and closed).
   - 50 from layer 2 × 1,200 = 60,000 (50 @ 1,200 remain).
   - Cost entry (`-COGS`): debit `51101` **160,000** / credit `11301` **160,000**.
4. **Return:** a 20-unit return on the same invoice reverses the **frozen original cost** (`unit_cost`) — never an estimated ratio.

### Standard-method example — variance is confronted, not hidden

Item standard cost 1,000; you buy 100 units × 1,100 = 110,000:

| Account | Debit (YER) | Credit (YER) |
|---|---|---:|
| Inventory `11301` (100 × standard 1,000) | 100,000 | |
| Purchase Price Variance `51901` | 10,000 | |
| Accounts payable | | 110,000 |

The 10,000 gap shows explicitly in `51901` — never buried in inventory.

## Key Rules — quick summary

| Rule | Detail |
|---|---|
| Receipts always open a layer | Even outside FIFO — a future method switch stays accurate with no retrofitting |
| Original cost is frozen, never inferred | `unit_cost` on the invoice line at posting; returns reverse the stored value, not a guess |
| Method changes apply forward only | No historical restatement — prior balances stay as posted |
| Empty `standard_cost` falls back to average | An item without standard cost is valued at average automatically under standard |

## Common Errors & Fixes

| Message | Cause | Fix |
|---|---|---|
| Zero sales cost for a sold item | Service line without stock tracking, or standard method with no `standard_cost` and zero average | Enter the standard cost on the card, or check the item is stocked |
| Phantom 100% margin | Sales posted before purchase costs were entered | Enter purchase invoices first — cost freezes at sale posting time |
| Negative FIFO layers | Issue exceeded available stock (audited override) | Review the `allow_negative_sale` policy and the audit log |

## Tips

- Pick one method and stick to it — frequent switching breaks period comparability.
- Before switching to FIFO, build opening layers from current balances (the system builds them at switch time).
- Review `51901` monthly under standard — a steadily growing balance means your standards are outdated.

# Example 06 — Al-Shifa Pharmacy (FIFO, return & shortage)

> Two purchase layers at two prices, a sale eating oldest first, a return at frozen original cost, and a count shortage. Closing stock of 65 units × 1,200 = 78,000 ties to the layers.

## Company card

| Item | Value |
|---|---|
| Name | Al-Shifa Pharmacy |
| Base currency | YER |
| Tax jurisdiction | `YE` |
| Valuation method | `fifo` |

## Opening balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 3,000,000 | |
| Capital `31101` | | 3,000,000 |

## Transactions (single item: test strips)

| # | Transaction | Amount (YER) |
|---|---|---:|
| 1 | Buy 100 units × 1,000 on credit (layer 1) | 100,000 |
| 2 | Buy 100 units × 1,200 on credit (layer 2) | 120,000 |
| 3 | Cash sale of 150 units × 2,000 | 300,000 |
| 4 | Return of 20 units in cash (from layer 2: 20 × 1,200) | 40,000 |
| 5 | Count shortage of 5 units × 1,200 | 6,000 |

## Full solution — posted entries

| Ref | Description | Debit | Credit |
|---|---|---|---|
| OPEN | Opening | 3,000,000 | 3,000,000 |
| P-01 | Purchase: `11301` / `21101` | 100,000 | 100,000 |
| P-02 | Purchase: `11301` / `21101` | 120,000 | 120,000 |
| S-01 | Sale: `11101` / `41101` | 300,000 | 300,000 |
| S-01C | FIFO cost: 100×1,000 + 50×1,200 = 160,000 (`51101` / `11301`) | 160,000 | 160,000 |
| SR-01 | Return: `41103` / `11101` | 40,000 | 40,000 |
| SR-01C | Original-cost reversal: `11301` / `51101` (20 × 1,200) | 24,000 | 24,000 |
| ADJ-01 | Shortage: `52901` / `11301` (5 × 1,200) | 6,000 | 6,000 |

## Layer tie-out (extra check)

| Layer | Movement | Remaining |
|---|---|---|
| Layer 1 (1,000) | 100 − 100 | 0 |
| Layer 2 (1,200) | 100 − 50 + 20 − 5 | 65 units = **78,000** |

## Trial balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` (3,000,000 + 300,000 − 40,000) | 3,260,000 | |
| Inventory `11301` | 78,000 | |
| Suppliers `21101` | | 220,000 |
| Capital `31101` | | 3,000,000 |
| Sales `41101` | | 300,000 |
| Sales returns `41103` | 40,000 | |
| COGS `51101` (160,000 − 24,000) | 136,000 | |
| Inventory shortage `52901` | 6,000 | |
| **Total** | **3,520,000** | **3,520,000** |

## Income statement

| Item | Amount (YER) |
|---|---:|
| Net sales (300,000 − 40,000) | 260,000 |
| Cost of sales (160,000 − 24,000) | (136,000) |
| **Gross profit** | **124,000** |
| Count shortage | (6,000) |
| **Net profit** | **118,000** |

## Balance sheet

| Item | Amount (YER) |
|---|---:|
| Cash 3,260,000 + inventory 78,000 | 3,338,000 |
| Suppliers | (220,000) |
| Capital 3,000,000 + profit 118,000 | (3,118,000) |
| **Difference (must be zero)** | **0** |

## Cash flow

| Item | Amount (YER) |
|---|---:|
| Opening balance | 3,000,000 |
| Receipts (sale 300,000) | 300,000 |
| Payments (return refund 40,000) | (40,000) |
| **Closing balance** | **3,260,000** |

## Comparison & error-spotting checklist

1. Inventory 78,000 must equal 65 × 1,200 from the layers — any gap means consumption from the wrong layer.
2. Return cost 24,000 (layer price 1,200), not 20,000 (old layer price 1,000) — the frozen price is correct.
3. The 6,000 shortage is a `52901` expense, not a sales reduction — mixing them inflates gross profit and hides shrinkage.
4. Common mistake: valuing the return at moving average 1,100 (22,000) — breaks the layer tie-out by 2,000.

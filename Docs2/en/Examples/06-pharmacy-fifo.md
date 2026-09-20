# Example 06 — Al-Shifa Pharmacy (FIFO, return, shortage & payment)

> Two purchase layers at two prices, two sales eating oldest first, a return at frozen cost, an approved shortage, and a linked supplier payment. Closing stock of 25 units × 1,200 = 30,000 ties to the layers.

## 1. Company card

| Item | Value |
|---|---|
| Name | Al-Shifa Pharmacy |
| Base currency | YER |
| Tax jurisdiction | `YE` |
| Valuation method | `fifo` |

## 2. Master data

| Entry | Detail |
|---|---|
| Cash box | `CB-PHARM` ← `11101` |
| Supplier | United Pharma Co. (credit) |
| Employee | Dr. Mona — pharmacist |
| Product | Test strips: box (base) / carton × 50 — barcode 625600600001 |
| Warehouse | Pharmacy — Aden |

## 3. Opening balance (01-01)

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 3,000,000 | |
| Capital `31101` | | 3,000,000 |

## 4. Dated transactions

| Date | Screen | Transaction | Amount (YER) |
|---|---|---|---:|
| 01-04 | Purchase invoice | 100 boxes × 1,000 on credit (layer 1) | 100,000 |
| 01-07 | Purchase invoice | 100 boxes × 1,200 on credit (layer 2) | 120,000 |
| 01-10 | Sales invoice | Cash sale of 150 boxes × 2,000 | 300,000 |
| 01-14 | Sales return | 20 boxes in cash (from layer 2) | 40,000 |
| 01-18 | Sales invoice | Cash sale of 40 boxes × 2,000 (from layer 2) | 80,000 |
| 01-22 | Stock adjustment | Shortage of 5 boxes × 1,200, approved and posted | 6,000 |
| 01-25 | Payment voucher | Pay supplier linked to first invoice | 150,000 |

## 5. Full solution — posted entries

| Ref | Description | Debit | Credit |
|---|---|---|---|
| OPEN | Opening | 3,000,000 | 3,000,000 |
| P-01 | Purchase: `11301` / `21101` | 100,000 | 100,000 |
| P-02 | Purchase: `11301` / `21101` | 120,000 | 120,000 |
| S-01 | Sale: `11101` / `41101` | 300,000 | 300,000 |
| S-01C | FIFO cost: 100×1,000 + 50×1,200 = 160,000 | 160,000 | 160,000 |
| SR-01 | Return: `41103` / `11101` | 40,000 | 40,000 |
| SR-01C | Cost reversal: `11301` / `51101` (20 × 1,200) | 24,000 | 24,000 |
| S-02 | Sale: `11101` / `41101` | 80,000 | 80,000 |
| S-02C | Cost: `51101` / `11301` (40 × 1,200) | 48,000 | 48,000 |
| ADJ-01 | Shortage: `52901` / `11301` (5 × 1,200) | 6,000 | 6,000 |
| V-01 | Pay supplier: `21101` / `11101` | 150,000 | 150,000 |

## 6. Layer tie-out

| Layer | Movement | Remaining |
|---|---|---|
| Layer 1 (1,000) | 100 − 100 | 0 |
| Layer 2 (1,200) | 100 − 50 + 20 − 40 − 5 | 25 boxes = **30,000** |

## 7. Trial balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` (3,000,000 + 300,000 − 40,000 + 80,000 − 150,000) | 3,190,000 | |
| Inventory `11301` | 30,000 | |
| Suppliers `21101` (220,000 − 150,000) | | 70,000 |
| Capital `31101` | | 3,000,000 |
| Sales `41101` (300,000 + 80,000) | | 380,000 |
| Sales returns `41103` | 40,000 | |
| COGS `51101` (160,000 − 24,000 + 48,000) | 184,000 | |
| Inventory shortage `52901` | 6,000 | |
| **Total** | **3,450,000** | **3,450,000** |

## 8. Income statement

| Item | Amount (YER) |
|---|---:|
| Net sales (380,000 − 40,000) | 340,000 |
| Cost of sales (160,000 − 24,000 + 48,000) | (184,000) |
| **Gross profit** | **156,000** |
| Count shortage | (6,000) |
| **Net profit** | **150,000** |

## 9. Balance sheet

| Item | Amount (YER) |
|---|---:|
| Cash 3,190,000 + inventory 30,000 | 3,220,000 |
| Suppliers | (70,000) |
| Capital 3,000,000 + profit 150,000 | (3,150,000) |
| **Difference (must be zero)** | **0** |

## 10. Cash flow

| Item | Amount (YER) |
|---|---:|
| Opening balance | 3,000,000 |
| Receipts (300,000 + 80,000) | 380,000 |
| Payments (return refund 40,000 + supplier 150,000) | (190,000) |
| **Closing balance** | **3,190,000** |

## 11. Year-end close (`CLS-2026`)

| Account | Debit | Credit |
|---|---|---:|
| Sales `41101` | 380,000 | |
| Sales returns `41103` | | 40,000 |
| COGS `51101` | | 184,000 |
| Inventory shortage `52901` | | 6,000 |
| Retained earnings `32101` | | 150,000 |
| **Total** | **380,000** | **380,000** |

After close: trial balance 3,220,000 ✓.

## 12. Comparison & error-spotting checklist

1. (Layers) 25 × 1,200 = 30,000 must equal `11301` — any gap means consumption from the wrong layer.
2. (Suppliers) 70,000 = 220,000 − 150,000 — unlinked payment leaves 220,000 with wrong invoice allocation.
3. Return cost at layer price (1,200), not the first purchase price (1,000).
4. Shortage is a `52901` expense, not a sales reduction — mixing them inflates margin and hides shrinkage.
5. Common mistake: costing the second sale at moving average (≈1,048) instead of the FIFO layer (1,200) — breaks the tie-out.

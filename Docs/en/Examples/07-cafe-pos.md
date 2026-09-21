# Example 07 — Al-Diwan Café POS (shifts, differences & custody)

> Three shifts: a short auto-posted (`POS-DIFF` debit `52901`), an exact one with no entry, and an over auto-posted (credit `41901`) — plus a credit purchase and its payment, and a cashier custody settled by expense plus cash return.

## 1. Company card

| Item | Value |
|---|---|
| Name | Al-Diwan Café |
| Base currency | YER |
| Tax jurisdiction | `YE` |

## 2. Master data

| Entry | Detail |
|---|---|
| Cash box | `CB-CAFE` ← `11101` (drawer float 500,000) |
| Customers | Walk-in (cash) + neighboring company (registered credit) |
| Supplier | Beans & milk supplier (credit) |
| Employee | Khaled — cashier (custody 50,000) |
| Products | Beans (kg/bag × 10), milk (liter/carton × 12), cups (cup/bundle × 50) |
| Warehouse | Café store |

## 3. Opening balance (01-01)

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 500,000 | |
| Capital `31101` | | 500,000 |

## 4. Dated transactions

| Date | Screen | Transaction | Amount (YER) |
|---|---|---|---:|
| 01-02 | Purchase invoice | Beans in cash | 300,000 |
| 01-05 | Shift 1 | Cash sales 250,000 (cost 100,000) | 250,000 |
| 01-05 | Shift 1 | Credit sale to neighboring company 60,000 (cost 24,000) | 60,000 |
| 01-05 | Close shift | Expected 250,000, counted 248,000 → short 2,000 (`POS-DIFF`) | 2,000 |
| 01-12 | Shift 2 | Cash sales 180,000 (cost 72,000) — exact count | 180,000 |
| 01-15 | Payment voucher | Packaging in cash | 20,000 |
| 01-18 | Purchase invoice | Beans on credit | 120,000 |
| 01-20 | Payment voucher | Pay the beans supplier | 120,000 |
| 01-22 | Shift 3 | Cash sales 90,000 (cost 36,000) | 90,000 |
| 01-22 | Close shift | Expected 90,000, counted 91,000 → over 1,000 (`POS-DIFF`) | 1,000 |
| 01-25 | Custody | Cashier custody | 50,000 |
| 01-28 | Settle custody | 30,000 expense from custody + 20,000 returned to box | 50,000 |

## 5. Full solution — posted entries

| Ref | Description | Debit | Credit |
|---|---|---|---|
| OPEN | Drawer float | 500,000 | 500,000 |
| P-01 | Goods: `11301` / `11101` | 300,000 | 300,000 |
| Z1-01 | Cash sale: `11101` / `41101` | 250,000 | 250,000 |
| Z1-01C | Cost: `51101` / `11301` | 100,000 | 100,000 |
| Z1-02 | Credit sale: `11201` / `41101` | 60,000 | 60,000 |
| Z1-02C | Cost: `51101` / `11301` | 24,000 | 24,000 |
| Z1-DIFF | Short close: `52901` / `11101` | 2,000 | 2,000 |
| Z2-01 | Cash sale: `11101` / `41101` | 180,000 | 180,000 |
| Z2-01C | Cost: `51101` / `11301` | 72,000 | 72,000 |
| X-01 | Packaging: `52301` / `11101` | 20,000 | 20,000 |
| P-02 | Beans on credit: `11301` / `21101` | 120,000 | 120,000 |
| V-02 | Pay supplier: `21101` / `11101` | 120,000 | 120,000 |
| Z3-01 | Cash sale: `11101` / `41101` | 90,000 | 90,000 |
| Z3-01C | Cost: `51101` / `11301` | 36,000 | 36,000 |
| Z3-OVER | Over close: `11101` / `41901` | 1,000 | 1,000 |
| AD-01 | Custody: `11202` / `11101` | 50,000 | 50,000 |
| AD-02 | Settlement: `52301` 30,000 + `11101` 20,000 / `11202` | 50,000 | 50,000 |

## 6. Trial balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 549,000 | |
| Customers `11201` | 60,000 | |
| Inventory `11301` (300,000 + 120,000 − 100,000 − 24,000 − 72,000 − 36,000) | 188,000 | |
| Capital `31101` | | 500,000 |
| Sales `41101` (250,000 + 60,000 + 180,000 + 90,000) | | 580,000 |
| Inventory surplus `41901` (cash over) | | 1,000 |
| COGS `51101` | 232,000 | |
| Sundry expenses `52301` (20,000 + 30,000) | 50,000 | |
| Inventory shortage `52901` (cash short) | 2,000 | |
| **Total** | **1,081,000** | **1,081,000** |

> Supplier is zero (120,000 − 120,000) and custody is zero (50,000 − 50,000) — their absence from the trial balance marks full settlement.

## 7. Income statement

| Item | Amount (YER) |
|---|---:|
| Sales 580,000 + over 1,000 | 581,000 |
| Cost of sales | (232,000) |
| **Gross profit** | **349,000** |
| Packaging and custody expense 50,000 + cash short 2,000 | (52,000) |
| **Net profit** | **297,000** |

## 8. Balance sheet

| Item | Amount (YER) |
|---|---:|
| Cash 549,000 + customers 60,000 + inventory 188,000 | 797,000 |
| Capital 500,000 + profit 297,000 | (797,000) |
| **Difference (must be zero)** | **0** |

## 9. Cash flow

| Item | Amount (YER) |
|---|---:|
| Opening balance | 500,000 |
| Receipts (250,000 + 180,000 + 90,000 + custody return 20,000) | 540,000 |
| Payments (goods 300,000 + packaging 20,000 + supplier 120,000 + custody 50,000) | (490,000) |
| Cash difference (short 2,000 − over 1,000) | (1,000) |
| **Closing balance** | **549,000** |

## 10. Year-end close (`CLS-2026`)

| Account | Debit | Credit |
|---|---|---:|
| Sales `41101` | 580,000 | |
| Inventory surplus `41901` | 1,000 | |
| COGS `51101` | | 232,000 |
| Sundry `52301` | | 50,000 |
| Inventory shortage `52901` | | 2,000 |
| Retained earnings `32101` | | 297,000 |
| **Total** | **581,000** | **581,000** |

After close: trial balance 797,000 ✓.

## 11. Comparison & error-spotting checklist

1. (Drawer) Expected = float + cash only — the 60,000 credit stays out, always.
2. (Differences) Short is debit `52901`, over is credit `41901` — merging them hides the nature of each.
3. (Custody) Zero after the three-way settlement (expense + cash return vs custody) — settling by expense alone (50,000) overstates expenses by 20,000.
4. (Supplier) Zero after linked payment — unlinked payment leaves invoice allocation wrong.
5. Common mistake: recording the short manually **then** the automatic close — a double. One method only.

# Example 10 — Al-Nokhba Wholesale (credit, discounts & aging)

> Two credit customers, partial collection, discount allowed, return, and a supplier payment. Receivables aging: customer A 300,000 (0–30) and customer B 950,000 (31–60) — total 1,250,000 ties to receivables.

## Company card

| Item | Value |
|---|---|
| Name | Al-Nokhba Wholesale Distributor |
| Base currency | YER |
| Tax jurisdiction | `YE` |

## Opening balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 4,000,000 | |
| Inventory `11301` | 3,000,000 | |
| Capital `31101` | | 7,000,000 |

## Transactions

| # | Transaction | Amount (YER) |
|---|---|---:|
| 1 | Credit purchase invoice | 2,000,000 |
| 2 | Credit sale to customer A 1,500,000 (cost 900,000) | 1,500,000 |
| 3 | Credit sale to customer B 1,000,000 (cost 600,000) | 1,000,000 |
| 4 | Partial collection from A | 1,000,000 |
| 5 | Discount allowed to B (early payment) | 50,000 |
| 6 | Return from A 200,000 (cost 120,000) | 200,000 |
| 7 | Pay the supplier | 1,500,000 |
| 8 | Salaries in cash | 250,000 |

## Full solution — posted entries

| Ref | Description | Debit | Credit |
|---|---|---|---|
| OPEN | Opening | 7,000,000 | 7,000,000 |
| P-01 | Purchase: `11301` / `21101` | 2,000,000 | 2,000,000 |
| S-A | Sale to A: `11201` / `41101` | 1,500,000 | 1,500,000 |
| S-AC | Cost: `51101` / `11301` | 900,000 | 900,000 |
| S-B | Sale to B: `11201` / `41101` | 1,000,000 | 1,000,000 |
| S-BC | Cost: `51101` / `11301` | 600,000 | 600,000 |
| R-A | Collection: `11101` / `11201` | 1,000,000 | 1,000,000 |
| D-B | Discount: `41201` / `11201` | 50,000 | 50,000 |
| SR-A | Return: `41103` / `11201` | 200,000 | 200,000 |
| SR-AC | Cost reversal: `11301` / `51101` | 120,000 | 120,000 |
| V-01 | Pay supplier: `21101` / `11101` | 1,500,000 | 1,500,000 |
| X-01 | Salaries: `52101` / `11101` | 250,000 | 250,000 |

## Receivables aging (by due date)

| Customer | 0–30 | 31–60 | Total |
|---|---|---:|---:|
| A (1,500,000 − 1,000,000 − 200,000) | 300,000 | | 300,000 |
| B (1,000,000 − 50,000) | | 950,000 | 950,000 |
| **Total (ties to `11201`)** | **300,000** | **950,000** | **1,250,000** |

## Trial balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 3,250,000 | |
| Customers `11201` | 1,250,000 | |
| Inventory `11301` (3,000,000 + 2,000,000 − 900,000 − 600,000 + 120,000) | 3,620,000 | |
| Suppliers `21101` (2,000,000 − 1,500,000) | | 500,000 |
| Capital `31101` | | 7,000,000 |
| Sales `41101` | | 2,500,000 |
| Sales returns `41103` | 200,000 | |
| Discounts allowed `41201` | 50,000 | |
| COGS `51101` (900,000 + 600,000 − 120,000) | 1,380,000 | |
| Salaries `52101` | 250,000 | |
| **Total** | **10,000,000** | **10,000,000** |

## Income statement

| Item | Amount (YER) |
|---|---:|
| Sales 2,500,000 − returns 200,000 − discount 50,000 | 2,250,000 |
| Cost of sales | (1,380,000) |
| **Gross profit** | **870,000** |
| Salaries | (250,000) |
| **Net profit** | **620,000** |

## Balance sheet

| Item | Amount (YER) |
|---|---:|
| Cash 3,250,000 + customers 1,250,000 + inventory 3,620,000 | 8,120,000 |
| Suppliers | (500,000) |
| Capital 7,000,000 + profit 620,000 | (7,620,000) |
| **Difference (must be zero)** | **0** |

## Cash flow

| Item | Amount (YER) |
|---|---:|
| Opening balance | 4,000,000 |
| Receipts (collection 1,000,000) | 1,000,000 |
| Payments (supplier 1,500,000 + salaries 250,000) | (1,750,000) |
| **Closing balance** | **3,250,000** |

## Comparison & error-spotting checklist

1. Aging total 1,250,000 must equal `11201` — any gap means a voucher/return without a due date.
2. The 50,000 discount sits in `41201` (reduces revenue), not in expenses — expensing it inflates gross profit.
3. Customer A = 300,000: 1,500,000 means both collection and return were forgotten.
4. Common mistake: recording the return as a purchase reduction instead of `41103` — hides true sales and distorts the customer margin.

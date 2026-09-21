# Example 10 — Al-Nokhba Wholesale (credit, discounts, aging & advances)

> Two credit customers plus a third from a lead (no invoice), two collections, discount allowed, return, purchase return, supplier payment, a driver advance settled by fuel plus cash return — with aging tied to receivables, then close.

## 1. Company card

| Item | Value |
|---|---|
| Name | Al-Nokhba Wholesale Distributor |
| Base currency | YER |
| Tax jurisdiction | `YE` |

## 2. Master data

| Entry | Detail |
|---|---|
| Cash box | `CB-MAIN` ← `11101` |
| Customers | A: Al-Nasr Grocery (credit) • B: Al-Salam Supermarket (credit) • C: Gulf Establishment (from lead — no invoice yet) |
| Supplier | Main supplier (credit) |
| Employee | Distribution driver (advance 60,000) |
| Products | Flour (bag/sack × 20), sugar (bag/sack × 20), oil (jerry/carton × 6) |
| Warehouse | Wholesale warehouse |

## 3. Opening balance (01-01)

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 4,000,000 | |
| Inventory `11301` | 3,000,000 | |
| Capital `31101` | | 7,000,000 |

## 4. Dated transactions (January 2026, aging cut-off 15-02)

| Date | Screen | Transaction | Amount (YER) |
|---|---|---|---:|
| 01-03 | Purchase invoice | On credit | 2,000,000 |
| 01-05 | Sales invoice | Credit to customer B (cost 600,000) | 1,000,000 |
| 01-08 | Sales invoice | Credit to customer A (cost 900,000) | 1,500,000 |
| 01-12 | Receipt voucher | Partial collection from A | 1,000,000 |
| 01-15 | Discount allowed | Early-payment discount for B | 50,000 |
| 01-18 | Sales return | From A (cost 120,000) | 200,000 |
| 01-20 | Payment voucher | Pay the supplier | 1,500,000 |
| 01-22 | Receipt voucher | Collection from B | 500,000 |
| 01-25 | Purchase return | Damaged items | 200,000 |
| 01-27 | Employee advance | Driver advance | 60,000 |
| 01-30 | Settle advance | Fuel 25,000 from advance + 35,000 cash returned | 60,000 |
| 01-31 | Payment voucher | Salaries in cash | 250,000 |

## 5. Full solution — posted entries

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
| R-B | Collection from B: `11101` / `11201` | 500,000 | 500,000 |
| PR-01 | Purchase return: `21101` / `11301` | 200,000 | 200,000 |
| AD-01 | Advance: `11202` / `11101` | 60,000 | 60,000 |
| AD-02 | Settlement: `52401` 25,000 + `11101` 35,000 / `11202` | 60,000 | 60,000 |
| X-01 | Salaries: `52101` / `11101` | 250,000 | 250,000 |

## 6. Receivables aging (as of 15-02)

| Customer | Invoice | 0–30 | 31–60 | Total |
|---|---|---:|---:|---:|
| A (08-01: 1,500,000 − 1,000,000 − 200,000) | 08-01 | 300,000 | | 300,000 |
| B (05-01: 1,000,000 − 50,000 − 500,000) | 05-01 | | 450,000 | 450,000 |
| **Total (ties to `11201`)** | | **300,000** | **450,000** | **750,000** |

## 7. Trial balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` (4,000,000 + 1,000,000 − 1,500,000 − 250,000 + 500,000 − 60,000 + 35,000) | 3,725,000 | |
| Customers `11201` | 750,000 | |
| Inventory `11301` (3,000,000 + 2,000,000 − 900,000 − 600,000 + 120,000 − 200,000) | 3,420,000 | |
| Suppliers `21101` (2,000,000 − 1,500,000 − 200,000) | | 300,000 |
| Capital `31101` | | 7,000,000 |
| Sales `41101` | | 2,500,000 |
| Sales returns `41103` | 200,000 | |
| Discounts allowed `41201` | 50,000 | |
| COGS `51101` | 1,380,000 | |
| Salaries `52101` | 250,000 | |
| Freight (fuel) `52401` | 25,000 | |
| **Total** | **9,800,000** | **9,800,000** |

> The advance is zero (60,000 − 60,000) and customer C carries no balance (converting a lead alone creates no receivable).

## 8. Income statement

| Item | Amount (YER) |
|---|---:|
| Sales 2,500,000 − returns 200,000 − discount 50,000 | 2,250,000 |
| Cost of sales | (1,380,000) |
| **Gross profit** | **870,000** |
| Salaries 250,000 + fuel 25,000 | (275,000) |
| **Net profit** | **595,000** |

## 9. Balance sheet

| Item | Amount (YER) |
|---|---:|
| Cash 3,725,000 + customers 750,000 + inventory 3,420,000 | 7,895,000 |
| Suppliers | (300,000) |
| Capital 7,000,000 + profit 595,000 | (7,595,000) |
| **Difference (must be zero)** | **0** |

## 10. Cash flow

| Item | Amount (YER) |
|---|---:|
| Opening balance | 4,000,000 |
| Receipts (1,000,000 + 500,000 + advance return 35,000) | 1,535,000 |
| Payments (supplier 1,500,000 + salaries 250,000 + advance 60,000) | (1,810,000) |
| **Closing balance** | **3,725,000** |

## 11. Year-end close (`CLS-2026`)

| Account | Debit | Credit |
|---|---|---:|
| Sales `41101` | 2,500,000 | |
| Sales returns `41103` | | 200,000 |
| Discounts allowed `41201` | | 50,000 |
| COGS `51101` | | 1,380,000 |
| Salaries `52101` | | 250,000 |
| Freight `52401` | | 25,000 |
| Retained earnings `32101` | | 595,000 |
| **Total** | **2,500,000** | **2,500,000** |

After close: trial balance 7,895,000 ✓.

## 12. Comparison & error-spotting checklist

1. (Aging) 750,000 = 300,000 + 450,000 ties to `11201` — any gap means a document without a due date.
2. (Suppliers) 300,000 = 2,000,000 − 1,500,000 − 200,000 — forgetting the purchase return leaves 500,000.
3. (Advance) Zero after the three-way settlement — settling by fuel alone (60,000) overstates expense by 35,000.
4. Discount in `41201` reduces revenue, not expense — expensing it inflates margin.
5. Common mistake: an invoice for customer C (newly converted) before any order — conversion alone creates no receivable and no revenue.

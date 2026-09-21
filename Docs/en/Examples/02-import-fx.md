# Example 02 — Al-Ofok Import (FX & differences)

> USD documents with a YER ledger: master data (two boxes, foreign customer/supplier, products, port warehouse), purchase return, inter-box transfer, realized and unrealized differences — then close.

## 1. Company card

| Item | Value |
|---|---|
| Name | Al-Ofok Import Co. |
| Base currency | YER — dealing: USD (1,500) |
| Tax jurisdiction | `YE` |

## 2. Master data

### Cash boxes (Settings ← Cash Boxes)

| Box | Ledger account |
|---|---|
| `CB-MAIN` Main box | `11101` |
| `BNK-INTL` Import account | `11102` |

### Customers, suppliers, employees

| Entry | Detail |
|---|---|
| Customer | Gulf Trading, foreign (USD, credit) |
| Supplier | Asia Foods, foreign (USD, credit) |
| Employee | Salem Bazaraa — accountant & customs clearer |

### Products & warehouse

| Product | Base unit | Alternate | Barcode |
|---|---|---|---|
| Basmati rice 20kg | Bag | Ton × 50 | 625200200001 |
| Sugar 50kg | Bag | Ton × 20 | 625200200002 |

| Warehouse | Location |
|---|---|
| Aden Port | Free zone |

## 3. Opening balance (01-01)

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 10,000,000 | |
| Capital `31101` | | 10,000,000 |

## 4. Dated transactions

| Date | Screen | Transaction | Amount |
|---|---|---|---:|
| 01-04 | Purchase invoice | 10,000 USD × 1,500 on credit | 15,000,000 YER |
| 01-07 | Sales invoice | Credit 8,000 USD × 1,500 (cost 9,000,000) | 12,000,000 YER |
| 01-12 | Receipt voucher | Collect 5,000 USD at 1,600 (received 8,000,000) — applied at invoice rate 7,500,000 + gain 500,000 | 8,000,000 YER |
| 01-15 | Payment voucher | Pay 6,000 USD at 1,600 (paid 9,600,000) — applied at invoice rate 9,000,000 + loss 600,000 | 9,600,000 YER |
| 01-20 | Payment voucher | Salaries in cash | 400,000 YER |
| 01-25 | Purchase return | 1,000 damaged USD × 1,500 | 1,500,000 YER |
| 01-28 | Box transfer | Main to import account | 2,000,000 YER |
| 01-31 | Revaluation | 3,000 USD receivable at 1,650 (gain 450,000) + 4,000 USD supplier dues at 1,650 (loss 600,000) | — |

## 5. Full solution — posted entries

| Ref | Description | Debit | Credit |
|---|---|---|---|
| OPEN | Opening | 10,000,000 | 10,000,000 |
| P-01 | Purchase: `11301` / `21101` | 15,000,000 | 15,000,000 |
| S-01 | Sale: `11201` / `41101` | 12,000,000 | 12,000,000 |
| S-01C | Cost: `51101` / `11301` | 9,000,000 | 9,000,000 |
| R-01 | Receipt: `11101` 8,000,000 / `11201` 7,500,000 / `52902` 500,000 | 8,000,000 | 8,000,000 |
| V-01 | Payment: `21101` 9,000,000 + `52902` 600,000 / `11101` 9,600,000 | 9,600,000 | 9,600,000 |
| X-01 | Salaries: `52101` / `11101` | 400,000 | 400,000 |
| PR-01 | Purchase return: `21101` / `11301` | 1,500,000 | 1,500,000 |
| T-01 | Transfer: `11102` / `11101` | 2,000,000 | 2,000,000 |
| FX-01 | Revalue receivables: `11201` / `52902` | 450,000 | 450,000 |
| FX-02 | Revalue payables: `52902` / `21101` | 600,000 | 600,000 |

## 6. Trial balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` (10,000,000 + 8,000,000 − 9,600,000 − 400,000 − 2,000,000) | 6,000,000 | |
| Import account `11102` | 2,000,000 | |
| Customers `11201` (12,000,000 − 7,500,000 + 450,000) | 4,950,000 | |
| Inventory `11301` (15,000,000 − 9,000,000 − 1,500,000) | 4,500,000 | |
| Suppliers `21101` (15,000,000 − 9,000,000 − 1,500,000 + 600,000) | | 5,100,000 |
| Capital `31101` | | 10,000,000 |
| Sales `41101` | | 12,000,000 |
| COGS `51101` | 9,000,000 | |
| Salaries `52101` | 400,000 | |
| FX differences `52902` (losses 1,200,000 − gains 950,000) | 250,000 | |
| **Total** | **27,100,000** | **27,100,000** |

## 7. Income statement

| Item | Amount (YER) |
|---|---:|
| Sales | 12,000,000 |
| Cost of sales | (9,000,000) |
| **Gross profit** | **3,000,000** |
| FX gains (500,000 + 450,000) | 950,000 |
| FX losses (600,000 + 600,000) | (1,200,000) |
| Salaries | (400,000) |
| **Net profit** | **2,350,000** |

## 8. Balance sheet

| Item | Amount (YER) |
|---|---:|
| Cash 6,000,000 + import 2,000,000 + customers 4,950,000 + inventory 4,500,000 | 17,450,000 |
| Suppliers | (5,100,000) |
| Capital 10,000,000 + profit 2,350,000 | (12,350,000) |
| **Difference (must be zero)** | **0** |

## 9. Cash flow

| Item | Amount (YER) |
|---|---:|
| Opening balance (both boxes) | 10,000,000 |
| Receipts (collection 8,000,000) | 8,000,000 |
| Payments (supplier 9,600,000 + salaries 400,000) | (10,000,000) |
| **Closing balance (6,000,000 + 2,000,000)** | **8,000,000** |

> The inter-box transfer (2,000,000) is an internal cash move — neither receipt nor payment.

## 10. Year-end close (`CLS-2026`)

| Account | Debit | Credit |
|---|---|---:|
| Sales `41101` | 12,000,000 | |
| COGS `51101` | | 9,000,000 |
| Salaries `52101` | | 400,000 |
| FX differences `52902` | | 250,000 |
| Retained earnings `32101` | | 2,350,000 |
| **Total** | **12,000,000** | **12,000,000** |

After close: trial balance 17,450,000 ✓.

## 11. Comparison & error-spotting checklist

1. (Suppliers) 5,100,000 = 15,000,000 − 9,000,000 − 1,500,000 + 600,000 — forgetting revaluation drops 600,000.
2. (Inventory) 4,500,000 after the return — entering the return as a voucher without stock effect leaves 6,000,000.
3. FX direction: receiving more than booked = credit gain; receiving less = debit loss.
4. (Cash flow) Both boxes together 8,000,000 — counting the main box alone (6,000,000) hides the transfer.
5. Common mistake: applying at the payment rate instead of the invoice rate — distorts the due and hides the difference.

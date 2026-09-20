# Example 02 — Al-Ofok Import (foreign currency & exchange differences)

> USD documents with a YER ledger: accrual at the invoice rate, differences as standalone `-FX` entries, then revaluation of open balances. Rate: 1 USD = 1,500 YER on invoices.

## Company card

| Item | Value |
|---|---|
| Name | Al-Ofok Import Co. |
| Base currency | YER — dealing currency: USD (1,500) |
| Tax jurisdiction | `YE` |

## Opening balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 10,000,000 | |
| Capital `31101` | | 10,000,000 |

## Transactions

| # | Transaction | Amount |
|---|---|---:|
| 1 | Purchase invoice: 10,000 USD × 1,500 (credit) | 15,000,000 YER |
| 2 | Credit sales invoice: 8,000 USD × 1,500 (cost 9,000,000) | 12,000,000 YER |
| 3 | Receipt: collect 5,000 USD at 1,600 (received 8,000,000) | Applied at invoice rate 7,500,000 + FX gain 500,000 |
| 4 | Payment: pay supplier 6,000 USD at 1,600 (paid 9,600,000) | Applied at invoice rate 9,000,000 + FX loss 600,000 |
| 5 | Salaries in cash | 400,000 YER |
| 6 | Revalue remaining 3,000 USD receivable at 1,650 | Gain 450,000 |
| 7 | Revalue remaining 4,000 USD supplier dues at 1,650 | Loss 600,000 |

## Full solution — posted entries

| Ref | Description | Debit | Credit |
|---|---|---|---|
| OPEN | Opening | 10,000,000 | 10,000,000 |
| P-01 | Purchase: `11301` / `21101` | 15,000,000 | 15,000,000 |
| S-01 | Sale: `11201` / `41101` | 12,000,000 | 12,000,000 |
| S-01C | Cost: `51101` / `11301` | 9,000,000 | 9,000,000 |
| R-01 | Receipt: `11101` 8,000,000 / `11201` 7,500,000 / `52902` (gain) 500,000 | 8,000,000 | 8,000,000 |
| V-01 | Payment: `21101` 9,000,000 + `52902` (loss) 600,000 / `11101` 9,600,000 | 9,600,000 | 9,600,000 |
| X-01 | Salaries: `52101` / `11101` | 400,000 | 400,000 |
| FX-01 | Revalue receivables: `11201` / `52902` | 450,000 | 450,000 |
| FX-02 | Revalue payables: `52902` / `21101` | 600,000 | 600,000 |

## Trial balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 8,000,000 | |
| Customers `11201` | 4,950,000 | |
| Inventory `11301` | 6,000,000 | |
| Suppliers `21101` | | 6,600,000 |
| Capital `31101` | | 10,000,000 |
| Sales `41101` | | 12,000,000 |
| COGS `51101` | 9,000,000 | |
| Salaries `52101` | 400,000 | |
| FX differences `52902` (net debit: losses 1,200,000 − gains 950,000) | 250,000 | |
| **Total** | **28,600,000** | **28,600,000** |

## Income statement

| Item | Amount (YER) |
|---|---:|
| Sales | 12,000,000 |
| Cost of sales | (9,000,000) |
| **Gross profit** | **3,000,000** |
| FX gains (500,000 + 450,000) | 950,000 |
| FX losses (600,000 + 600,000) | (1,200,000) |
| Salaries | (400,000) |
| **Net profit** | **2,350,000** |

## Balance sheet

| Item | Amount (YER) |
|---|---:|
| Cash 8,000,000 + customers 4,950,000 + inventory 6,000,000 | 18,950,000 |
| Suppliers | (6,600,000) |
| Capital 10,000,000 + profit 2,350,000 | (12,350,000) |
| **Difference (must be zero)** | **0** |

## Cash flow

| Item | Amount (YER) |
|---|---:|
| Opening balance | 10,000,000 |
| Receipts (collection 8,000,000) | 8,000,000 |
| Payments (supplier 9,600,000 + salaries 400,000) | (10,000,000) |
| **Closing balance** | **8,000,000** |

## Comparison & error-spotting checklist

1. Customer balance 4,950,000 (= 12,000,000 − 7,500,000 + 450,000) — 4,500,000 means the revaluation entry is missing.
2. FX direction: receiving **more** base than booked = **credit** `52902` gain; receiving less = debit loss. Reversed direction is the most common currency mistake.
3. `52902` net debit 250,000: a credit balance means you mixed the collection gain with the payment loss.
4. Common mistake: applying the voucher at the payment rate instead of the invoice rate — distorts the due and hides the difference.

# Example 01 — Al-Amana Store (basic trading cycle, no tax)

> Yemeni company (`YE` — no VAT): credit purchase, cash and credit sales, collection, return, expenses. The trainee learns: double-entry, atomic posting (invoice + cost), and the balance equation.

## Company card (enter into the system)

| Item | Value |
|---|---|
| Name | Al-Amana Store |
| Base currency | YER |
| Tax jurisdiction | `YE` (zero-rated — no tax on documents) |
| Valuation method | Moving average |

## Opening balance (enter first, then post)

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 5,000,000 | |
| Inventory `11301` | 2,000,000 | |
| Capital `31101` | | 7,000,000 |

## Transactions (enter as drafts, then post one by one)

| # | Transaction | Amount (YER) |
|---|---|---:|
| 1 | Credit purchase invoice (goods) | 1,500,000 |
| 2 | Cash sales invoice (sold items cost 1,200,000) | 2,000,000 |
| 3 | Credit sales invoice (cost 480,000) | 800,000 |
| 4 | Receipt voucher from customer (partial collection) | 500,000 |
| 5 | Payment voucher: rent in cash | 150,000 |
| 6 | Payment voucher: salaries in cash | 300,000 |
| 7 | Sales return from #3 (return cost 60,000) | 100,000 |

## Full solution — posted entries

| Ref | Description | Debit | Credit |
|---|---|---|---|
| OPEN | Opening: cash/inventory vs capital | 7,000,000 | 7,000,000 |
| P-01 | Purchase: `11301` / `21101` | 1,500,000 | 1,500,000 |
| S-01 | Cash sale: `11101` / `41101` | 2,000,000 | 2,000,000 |
| S-01C | Cost of sale: `51101` / `11301` | 1,200,000 | 1,200,000 |
| S-02 | Credit sale: `11201` / `41101` | 800,000 | 800,000 |
| S-02C | Cost of sale: `51101` / `11301` | 480,000 | 480,000 |
| R-01 | Collection: `11101` / `11201` | 500,000 | 500,000 |
| X-01 | Rent: `52201` / `11101` | 150,000 | 150,000 |
| X-02 | Salaries: `52101` / `11101` | 300,000 | 300,000 |
| SR-01 | Return: `41103` / `11201` | 100,000 | 100,000 |
| SR-01C | Cost reversal: `11301` / `51101` | 60,000 | 60,000 |

## Trial balance (correct solution for comparison)

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 7,050,000 | |
| Customers `11201` | 200,000 | |
| Inventory `11301` | 1,880,000 | |
| Suppliers `21101` | | 1,500,000 |
| Capital `31101` | | 7,000,000 |
| Sales `41101` | | 2,800,000 |
| Sales returns `41103` | 100,000 | |
| COGS `51101` | 1,620,000 | |
| Salaries `52101` | 300,000 | |
| Rent `52201` | 150,000 | |
| **Total** | **11,300,000** | **11,300,000** |

## Income statement

| Item | Amount (YER) |
|---|---:|
| Net sales (2,800,000 − 100,000) | 2,700,000 |
| Cost of sales (1,200,000 + 480,000 − 60,000) | (1,620,000) |
| **Gross profit** | **1,080,000** |
| Salaries + rent | (450,000) |
| **Net profit** | **630,000** |

## Balance sheet

| Item | Amount (YER) |
|---|---:|
| Cash 7,050,000 + customers 200,000 + inventory 1,880,000 | 9,130,000 |
| Suppliers | (1,500,000) |
| Capital 7,000,000 + profit 630,000 | (7,630,000) |
| **Difference (must be zero)** | **0** |

## Cash flow (direct)

| Item | Amount (YER) |
|---|---:|
| Opening balance | 5,000,000 |
| Receipts (cash sale 2,000,000 + collection 500,000) | 2,500,000 |
| Payments (rent 150,000 + salaries 300,000) | (450,000) |
| **Closing balance** | **7,050,000** |

## Comparison & error-spotting checklist

1. Compare the system trial balance line by line: any gap in `11301` means a forgotten cost (invoices posted without cost).
2. The customer balance must equal 200,000 (= 800,000 − 500,000 − 100,000) — 300,000 means the return was never linked.
3. Profit 630,000: higher means the return was never posted (or posted without cost reversal).
4. Common mistake: entering the collection as a new sales invoice — inflates revenue by 500,000 and leaves the customer debit.

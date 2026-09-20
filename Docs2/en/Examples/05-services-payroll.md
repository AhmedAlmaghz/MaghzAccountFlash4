# Example 05 — Afaq Consulting (services without inventory)

> A services company: no purchases, no inventory, no cost of sales. Focus: the atomic payroll Gross-up entry, and EOS/leave provisions (IAS 19).

## Company card

| Item | Value |
|---|---|
| Name | Afaq Consulting Co. |
| Base currency | YER |
| Tax jurisdiction | `YE` |

## Opening balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 2,000,000 | |
| Capital `31101` | | 2,000,000 |

## Transactions

| # | Transaction | Amount (YER) |
|---|---|---:|
| 1 | Credit service invoices (account `41102`) | 1,500,000 |
| 2 | Partial collection | 1,000,000 |
| 3 | Payroll run: gross 600,000, deductions 60,000, net 540,000 | — |
| 4 | Net salaries paid in cash | 540,000 |
| 5 | Rent in cash | 120,000 |
| 6 | End-of-service accrual (approval) | 80,000 |
| 7 | Leave provision (true-up) | 30,000 |

## Full solution — posted entries

| Ref | Description | Debit | Credit |
|---|---|---|---|
| OPEN | Opening | 2,000,000 | 2,000,000 |
| S-01 | Services: `11201` / `41102` | 1,500,000 | 1,500,000 |
| R-01 | Collection: `11101` / `11201` | 1,000,000 | 1,000,000 |
| PY-01 | Run: `52101` 600,000 / `21501` 540,000 / `21502` 60,000 | 600,000 | 600,000 |
| PY-02 | Net payment: `21501` / `11101` | 540,000 | 540,000 |
| X-01 | Rent: `52201` / `11101` | 120,000 | 120,000 |
| EOS-01 | Accrual: `52501` / `21503` | 80,000 | 80,000 |
| LV-01 | Leave provision: `52101` 30,000 / `21504` | 30,000 | 30,000 |

## Trial balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 2,340,000 | |
| Customers `11201` (1,500,000 − 1,000,000) | 500,000 | |
| Deductions payable `21502` | | 60,000 |
| EOS payable `21503` | | 80,000 |
| Leave provision `21504` | | 30,000 |
| Capital `31101` | | 2,000,000 |
| Services `41102` | | 1,500,000 |
| Salaries `52101` (600,000 + 30,000) | 630,000 | |
| Rent `52201` | 120,000 | |
| EOS expense `52501` | 80,000 | |
| **Total** | **3,670,000** | **3,670,000** |

## Income statement

| Item | Amount (YER) |
|---|---:|
| Service revenue | 1,500,000 |
| Salaries (600,000 + leave provision 30,000) | (630,000) |
| Rent | (120,000) |
| End of service | (80,000) |
| **Net profit** | **670,000** |

## Balance sheet

| Item | Amount (YER) |
|---|---:|
| Cash 2,340,000 + customers 500,000 | 2,840,000 |
| Deductions 60,000 + EOS 80,000 + leave provision 30,000 | (170,000) |
| Capital 2,000,000 + profit 670,000 | (2,670,000) |
| **Difference (must be zero)** | **0** |

## Cash flow

| Item | Amount (YER) |
|---|---:|
| Opening balance | 2,000,000 |
| Receipts (collection 1,000,000) | 1,000,000 |
| Payments (salaries 540,000 + rent 120,000) | (660,000) |
| **Closing balance** | **2,340,000** |

## Comparison & error-spotting checklist

1. `21501` must be **zero** (full net paid): a 540,000 credit remainder means the payment step was skipped.
2. `21502` credit 60,000: wrongly cleared? Deductions are a liability until remitted — never paid with the net.
3. Profit 670,000: 700,000 means the leave provision (30,000) was forgotten — the classic silent liability.
4. Common mistake: recording the run at net salaries as expense (540,000 instead of 600,000) — hides deductions from the books.

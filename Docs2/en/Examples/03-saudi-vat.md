# Example 03 — Riyadh Trading (15% VAT & VAT return)

> Saudi company (`SA`): input `21302` split from output `21301`, and the return read from entry legs. Teaching outcome: net input is higher — a **carried refund balance**, not a payment.

## Company card

| Item | Value |
|---|---|
| Name | Riyadh Trading Co. |
| Base currency | SAR (figures in Saudi Riyal) |
| Tax jurisdiction | `SA` — 15% |

## Opening balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 3,000,000 | |
| Capital `31101` | | 3,000,000 |

## Transactions

| # | Transaction | Amount (SAR) |
|---|---|---:|
| 1 | Credit purchase 2,000,000 + tax 300,000 | 2,300,000 |
| 2 | Credit sale 2,000,000 + tax 300,000 (cost 1,200,000) | 2,300,000 |
| 3 | Partial collection 2,000,000 from #2 | 2,000,000 |
| 4 | Sales return 200,000 + tax 30,000 (cost 120,000) | 230,000 |
| 5 | Purchase return 100,000 + tax 15,000 | 115,000 |
| 6 | Rent 100,000 + salaries 250,000 in cash | 350,000 |

## Full solution — posted entries

| Ref | Description | Debit | Credit |
|---|---|---|---|
| OPEN | Opening | 3,000,000 | 3,000,000 |
| P-01 | Purchase: `11301` 2,000,000 + `21302` 300,000 / `21101` | 2,300,000 | 2,300,000 |
| S-01 | Sale: `11201` / `41101` 2,000,000 / `21301` 300,000 | 2,300,000 | 2,300,000 |
| S-01C | Cost: `51101` / `11301` | 1,200,000 | 1,200,000 |
| R-01 | Collection: `11101` / `11201` | 2,000,000 | 2,000,000 |
| SR-01 | Return: `41103` 200,000 + `21301` 30,000 / `11201` | 230,000 | 230,000 |
| SR-01C | Cost reversal: `11301` / `51101` | 120,000 | 120,000 |
| PR-01 | Purchase return: `21101` / `11301` 100,000 / `21302` 15,000 | 115,000 | 115,000 |
| X-01/02 | Rent and salaries in cash | 350,000 | 350,000 |

## Trial balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 4,650,000 | |
| Customers `11201` (2,300,000 − 2,000,000 − 230,000) | 70,000 | |
| Inventory `11301` | 820,000 | |
| Suppliers `21101` | | 2,185,000 |
| Output VAT `21301` (300,000 − 30,000) | | 270,000 |
| Input VAT `21302` (300,000 − 15,000) | 285,000 | |
| Capital `31101` | | 3,000,000 |
| Sales `41101` | | 2,000,000 |
| Sales returns `41103` | 200,000 | |
| COGS `51101` | 1,080,000 | |
| Salaries `52101` | 250,000 | |
| Rent `52201` | 100,000 | |
| **Total** | **7,455,000** | **7,455,000** |

## VAT return (correct solution)

| Item | Amount (SAR) |
|---|---:|
| Net output (300,000 − 30,000) | 270,000 |
| Net input (300,000 − 15,000) | 285,000 |
| **Net: (15,000) refundable balance carried forward — no cash payment** | **(15,000)** |

## Income statement

| Item | Amount (SAR) |
|---|---:|
| Net sales (2,000,000 − 200,000) | 1,800,000 |
| Cost of sales (1,200,000 − 120,000) | (1,080,000) |
| **Gross profit** | **720,000** |
| Rent + salaries | (350,000) |
| **Net profit** | **370,000** |

## Balance sheet

| Item | Amount (SAR) |
|---|---:|
| Cash 4,650,000 + customers 70,000 + inventory 820,000 + recoverable input 285,000 | 5,825,000 |
| Suppliers 2,185,000 + output due 270,000 | (2,455,000) |
| Capital 3,000,000 + profit 370,000 | (3,370,000) |
| **Difference (must be zero)** | **0** |

## Cash flow

| Item | Amount (SAR) |
|---|---:|
| Opening balance | 3,000,000 |
| Receipts (collection 2,000,000) | 2,000,000 |
| Payments (rent 100,000 + salaries 250,000) | (350,000) |
| **Closing balance** | **4,650,000** |

## Comparison & error-spotting checklist

1. The return is a (15,000) refund: paying 135,000 means output was summed without deducting returns and input.
2. `21302` is a **debit** 285,000 (current asset) — a credit balance means the purchase entry direction was flipped.
3. Customer balance is only 70,000: 2,300,000 means the collection was forgotten; 300,000 means the return was forgotten.
4. Common mistake: computing the return from invoice-header `vat_amount` fields instead of entry legs — identical here, divergent once later discounts appear.

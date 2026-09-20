# Example 04 — Al-Noor Juice Factory (work orders & production cost)

> Full cycle: buy materials ← issue to work order (WIP) ← add labor ← complete with finished receipt ← sell finished goods. Total cost 500,000 = materials 400,000 + labor 100,000.

## Company card

| Item | Value |
|---|---|
| Name | Al-Noor Juice Factory |
| Base currency | YER |
| Tax jurisdiction | `YE` |

## Opening balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 4,000,000 | |
| Inventory (materials) `11301` | 1,000,000 | |
| Capital `31101` | | 5,000,000 |

## Transactions

| # | Transaction | Amount (YER) |
|---|---|---:|
| 1 | Credit purchase of materials | 500,000 |
| 2 | Start work order `WO-0001`: issue 400,000 of materials (out movement under the order number) | 400,000 |
| 3 | Production labor in cash (category `53101`) | 100,000 |
| 4 | Complete the order: receive 500,000 of finished goods into the FG warehouse | 500,000 |
| 5 | Cash sales invoice for finished goods 700,000 (cost 300,000) | 700,000 |
| 6 | Admin salaries in cash | 200,000 |

## Full solution — posted entries

| Ref | Description | Debit | Credit |
|---|---|---|---|
| OPEN | Opening | 5,000,000 | 5,000,000 |
| P-01 | Materials: `11301` / `21101` | 500,000 | 500,000 |
| W-START | Issue: `11302` / `11301` | 400,000 | 400,000 |
| W-LAB | Labor: `53101` / `11101` | 100,000 | 100,000 |
| W-DONE | Completion: `11303` / `11302` 400,000 / `53101` 100,000 | 500,000 | 500,000 |
| S-01 | Finished sale: `11101` / `41101` | 700,000 | 700,000 |
| S-01C | Cost: `51101` / `11303` | 300,000 | 300,000 |
| X-01 | Salaries: `52101` / `11101` | 200,000 | 200,000 |

## Trial balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 4,400,000 | |
| Materials inventory `11301` | 1,100,000 | |
| Finished inventory `11303` (500,000 − 300,000) | 200,000 | |
| Suppliers `21101` | | 500,000 |
| Capital `31101` | | 5,000,000 |
| Sales `41101` | | 700,000 |
| COGS `51101` | 300,000 | |
| Salaries `52101` | 200,000 | |
| **Total** | **6,200,000** | **6,200,000** |

> Note: `11302` (WIP) and `53101` (production labor) are **zero** after completion — dissolved into finished cost. Non-zero means an uncompleted order.

## Income statement

| Item | Amount (YER) |
|---|---:|
| Sales | 700,000 |
| Cost of sales | (300,000) |
| **Gross profit** | **400,000** |
| Admin salaries | (200,000) |
| **Net profit** | **200,000** |

## Balance sheet

| Item | Amount (YER) |
|---|---:|
| Cash 4,400,000 + materials 1,100,000 + finished 200,000 | 5,700,000 |
| Suppliers | (500,000) |
| Capital 5,000,000 + profit 200,000 | (5,200,000) |
| **Difference (must be zero)** | **0** |

## Cash flow

| Item | Amount (YER) |
|---|---:|
| Opening balance | 4,000,000 |
| Receipts (finished sale 700,000) | 700,000 |
| Payments (labor 100,000 + salaries 200,000) | (300,000) |
| **Closing balance** | **4,400,000** |

## Comparison & error-spotting checklist

1. `11302` must be zero: a 400,000 debit means the order was never completed (or completion is still a draft).
2. Unit cost produced = 500,000 ÷ quantity: different system cost means checking the frozen `unit_cost`.
3. `53101` zero after completion: a 100,000 debit remainder means labor bypassed the order (expensed directly instead of capitalized).
4. Common mistake: selling finished goods before completing the order — the gate refuses selling from zero stock (or audited override).

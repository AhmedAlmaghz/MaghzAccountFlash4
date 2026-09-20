# Example 07 — Al-Diwan Café POS (shifts & cash differences)

> Two shifts: cash and credit sales, a short close posted automatically (`POS-DIFF`), and an exact close with no entry. Credit never enters the drawer.

## Company card

| Item | Value |
|---|---|
| Name | Al-Diwan Café |
| Base currency | YER |
| Tax jurisdiction | `YE` |

## Opening balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` (drawer float 500,000) | 500,000 | |
| Capital `31101` | | 500,000 |

## Transactions

| # | Transaction | Amount (YER) |
|---|---|---:|
| 1 | Buy goods (beans) in cash | 300,000 |
| 2 | Shift 1: cash sales 250,000 (cost 100,000) | 250,000 |
| 3 | Shift 1: credit sale to a registered customer 60,000 (cost 24,000) | 60,000 |
| 4 | Close shift 1: expected 250,000, counted 248,000 → short 2,000 | 2,000 |
| 5 | Shift 2: cash sales 180,000 (cost 72,000), count exact | 180,000 |
| 6 | Packaging materials in cash | 20,000 |

## Full solution — posted entries

| Ref | Description | Debit | Credit |
|---|---|---|---|
| OPEN | Drawer float | 500,000 | 500,000 |
| P-01 | Goods: `11301` / `11101` | 300,000 | 300,000 |
| Z1-01 | Cash sale: `11101` / `41101` | 250,000 | 250,000 |
| Z1-01C | Cost: `51101` / `11301` | 100,000 | 100,000 |
| Z1-02 | Credit sale: `11201` / `41101` | 60,000 | 60,000 |
| Z1-02C | Cost: `51101` / `11301` | 24,000 | 24,000 |
| Z1-DIFF | Close difference: `52901` / `11101` (ref `POS-DIFF-...`) | 2,000 | 2,000 |
| Z2-01 | Cash sale: `11101` / `41101` | 180,000 | 180,000 |
| Z2-01C | Cost: `51101` / `11301` | 72,000 | 72,000 |
| X-01 | Packaging: `52301` / `11101` | 20,000 | 20,000 |

## Trial balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 608,000 | |
| Customers `11201` | 60,000 | |
| Inventory `11301` (300,000 − 100,000 − 24,000 − 72,000) | 104,000 | |
| Capital `31101` | | 500,000 |
| Sales `41101` (250,000 + 60,000 + 180,000) | | 490,000 |
| COGS `51101` | 196,000 | |
| Sundry expenses `52301` | 20,000 | |
| Shortage `52901` (cash difference) | 2,000 | |
| **Total** | **990,000** | **990,000** |

## Income statement

| Item | Amount (YER) |
|---|---:|
| Sales | 490,000 |
| Cost of sales | (196,000) |
| **Gross profit** | **294,000** |
| Packaging + cash difference | (22,000) |
| **Net profit** | **272,000** |

## Balance sheet

| Item | Amount (YER) |
|---|---:|
| Cash 608,000 + customers 60,000 + inventory 104,000 | 772,000 |
| Capital 500,000 + profit 272,000 | (772,000) |
| **Difference (must be zero)** | **0** |

## Cash flow

| Item | Amount (YER) |
|---|---:|
| Opening balance | 500,000 |
| Receipts (250,000 + 180,000) | 430,000 |
| Payments (goods 300,000 + packaging 20,000 + cash difference 2,000) | (322,000) |
| **Closing balance** | **608,000** |

## Comparison & error-spotting checklist

1. Drawer-expected = float + cash only (the 60,000 credit stays out) — including it inflates expected and flips the short into an over.
2. The exact shift 2 close carries **no difference entry** — a `POS-DIFF` there means a duplicate close (the entry is idempotent).
3. Customer balance 60,000: selling it as cash by mistake zeroes receivables and inflates cash.
4. Common mistake: recording the short as a manual expense **then** the automatic close — a 4,000 double. One method only.

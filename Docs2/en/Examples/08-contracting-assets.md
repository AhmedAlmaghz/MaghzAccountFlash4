# Example 08 — Modern Construction (contracting & fixed assets)

> Buy a 6,000,000 mixer with mandatory capitalization, 100,000 monthly depreciation, credit progress billings, and a credit subcontractor. Net fixed assets of 5,900,000 appear on the balance sheet.

## Company card

| Item | Value |
|---|---|
| Name | Modern Construction Co. |
| Base currency | YER |
| Tax jurisdiction | `YE` |

## Opening balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 8,000,000 | |
| Capital `31101` | | 8,000,000 |

## Transactions

| # | Transaction | Amount (YER) |
|---|---|---:|
| 1 | Buy mixer in cash — capitalized at creation | 6,000,000 |
| 2 | One month depreciation (60 months → 100,000) | 100,000 |
| 3 | Buy materials on credit | 1,000,000 |
| 4 | Project progress billing on credit (services revenue `41102`) | 2,500,000 |
| 5 | Partial collection on the billing | 2,000,000 |
| 6 | Subcontractor on credit (`52301`) | 800,000 |
| 7 | Pay the materials supplier | 1,000,000 |
| 8 | Salaries in cash | 300,000 |

## Full solution — posted entries

| Ref | Description | Debit | Credit |
|---|---|---|---|
| OPEN | Opening | 8,000,000 | 8,000,000 |
| FA-01 | Capitalize: `12101` / `11101` | 6,000,000 | 6,000,000 |
| FA-02 | Depreciation: `52601` / `12102` | 100,000 | 100,000 |
| P-01 | Materials: `11301` / `21101` | 1,000,000 | 1,000,000 |
| S-01 | Billing: `11201` / `41102` | 2,500,000 | 2,500,000 |
| R-01 | Collection: `11101` / `11201` | 2,000,000 | 2,000,000 |
| X-01 | Subcontractor: `52301` / `21101` | 800,000 | 800,000 |
| V-01 | Pay materials: `21101` / `11101` | 1,000,000 | 1,000,000 |
| X-02 | Salaries: `52101` / `11101` | 300,000 | 300,000 |

## Trial balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 2,700,000 | |
| Customers `11201` (2,500,000 − 2,000,000) | 500,000 | |
| Inventory `11301` | 1,000,000 | |
| Assets at cost `12101` | 6,000,000 | |
| Accumulated depreciation `12102` | | 100,000 |
| Suppliers `21101` (1,000,000 + 800,000 − 1,000,000) | | 800,000 |
| Capital `31101` | | 8,000,000 |
| Services `41102` | | 2,500,000 |
| Salaries `52101` | 300,000 | |
| Sundry (subcontractor) `52301` | 800,000 | |
| Depreciation `52601` | 100,000 | |
| **Total** | **11,400,000** | **11,400,000** |

## Income statement

| Item | Amount (YER) |
|---|---:|
| Billing revenue | 2,500,000 |
| Subcontractor | (800,000) |
| Salaries | (300,000) |
| Depreciation | (100,000) |
| **Net profit** | **1,300,000** |

## Balance sheet

| Item | Amount (YER) |
|---|---:|
| Cash 2,700,000 + customers 500,000 + materials 1,000,000 + net mixer 5,900,000 | 10,100,000 |
| Suppliers | (800,000) |
| Capital 8,000,000 + profit 1,300,000 | (9,300,000) |
| **Difference (must be zero)** | **0** |

## Cash flow

| Item | Amount (YER) |
|---|---:|
| Opening balance | 8,000,000 |
| Operating: collection 2,000,000 − supplier 1,000,000 − salaries 300,000 | 700,000 |
| Investing: mixer purchase | (6,000,000) |
| **Closing balance** | **2,700,000** |

## Comparison & error-spotting checklist

1. Net mixer 5,900,000 (= 6,000,000 − 100,000): 6,000,000 means the depreciation run was forgotten.
2. `12102` is a **credit** (contra) — a debit balance means the depreciation entry direction was flipped.
3. Suppliers 800,000 (subcontractor only): 1,800,000 means the materials payment was forgotten.
4. Common mistake: recording the mixer as a direct expense (6,000,000 in `52301`) — turns a 1,300,000 profit into a 4,700,000 loss and hides the asset.

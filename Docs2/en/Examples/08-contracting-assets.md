# Example 08 — Modern Construction (contracting & fixed assets)

> Master data (project client, supplier and subcontractor, engineer and worker, materials, site warehouse, tender), a mixer bought with mandatory capitalization and two depreciation months, billings with full collection, cash materials, subcontractor paid — then close.

## 1. Company card

| Item | Value |
|---|---|
| Name | Modern Construction Co. |
| Base currency | YER |
| Tax jurisdiction | `YE` |

## 2. Master data

| Entry | Detail |
|---|---|
| Cash box | `CB-CONST` ← `11101` |
| Customer | Towers project owner (progress billings on credit) |
| Suppliers | Materials supplier + electrical subcontractor |
| Employees | Eng. Rami (site engineer), Abdo (worker) |
| Products | Cement (bag/ton × 20), steel (ton) |
| Warehouse | Project-site warehouse |
| Lead | Government tender ← quotation ← won ← current project |

## 3. Opening balance (01-01)

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 8,000,000 | |
| Capital `31101` | | 8,000,000 |

## 4. Dated transactions

| Date | Screen | Transaction | Amount (YER) |
|---|---|---|---:|
| 01-03 | Fixed asset | Buy mixer in cash — capitalized at creation (`FA-0001`) | 6,000,000 |
| 01-10 | Depreciation | January (60 months) | 100,000 |
| 01-12 | Purchase invoice | Materials on credit | 1,000,000 |
| 01-15 | Sales invoice | Project billing on credit (`41102`) | 2,500,000 |
| 01-20 | Receipt voucher | Partial collection, linked | 2,000,000 |
| 01-22 | Payment voucher | Subcontractor on credit (`52301`) | 800,000 |
| 01-25 | Payment voucher | Pay materials supplier | 1,000,000 |
| 01-28 | Payment voucher | Salaries in cash | 300,000 |
| 02-10 | Depreciation | February | 100,000 |
| 02-12 | Receipt voucher | Collect billing remainder | 500,000 |
| 02-15 | Purchase invoice | Cement in cash | 200,000 |
| 02-18 | Payment voucher | Pay the subcontractor | 800,000 |

## 5. Full solution — posted entries

| Ref | Description | Debit | Credit |
|---|---|---|---|
| OPEN | Opening | 8,000,000 | 8,000,000 |
| FA-01 | Capitalize: `12101` / `11101` | 6,000,000 | 6,000,000 |
| FA-02 | January depreciation: `52601` / `12102` | 100,000 | 100,000 |
| P-01 | Materials: `11301` / `21101` | 1,000,000 | 1,000,000 |
| S-01 | Billing: `11201` / `41102` | 2,500,000 | 2,500,000 |
| R-01 | Collection: `11101` / `11201` | 2,000,000 | 2,000,000 |
| X-01 | Subcontractor: `52301` / `21101` | 800,000 | 800,000 |
| V-01 | Pay materials: `21101` / `11101` | 1,000,000 | 1,000,000 |
| X-02 | Salaries: `52101` / `11101` | 300,000 | 300,000 |
| FA-03 | February depreciation: `52601` / `12102` | 100,000 | 100,000 |
| R-02 | Collect remainder: `11101` / `11201` | 500,000 | 500,000 |
| P-02 | Cement in cash: `11301` / `11101` | 200,000 | 200,000 |
| V-02 | Pay subcontractor: `21101` / `11101` | 800,000 | 800,000 |

## 6. Trial balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 2,200,000 | |
| Inventory `11301` (1,000,000 + 200,000) | 1,200,000 | |
| Assets at cost `12101` | 6,000,000 | |
| Accumulated depreciation `12102` | | 200,000 |
| Capital `31101` | | 8,000,000 |
| Services `41102` | | 2,500,000 |
| Salaries `52101` | 300,000 | |
| Sundry (subcontractor) `52301` | 800,000 | |
| Depreciation `52601` (100,000 + 100,000) | 200,000 | |
| **Total** | **10,700,000** | **10,700,000** |

> Customers are zero (2,500,000 − 2,000,000 − 500,000) and suppliers are zero — full collection and payment wipe receivables and payables.

## 7. Income statement

| Item | Amount (YER) |
|---|---:|
| Billing revenue | 2,500,000 |
| Subcontractor | (800,000) |
| Salaries | (300,000) |
| Two months depreciation | (200,000) |
| **Net profit** | **1,200,000** |

## 8. Balance sheet

| Item | Amount (YER) |
|---|---:|
| Cash 2,200,000 + materials 1,200,000 + net mixer 5,800,000 | 9,200,000 |
| Capital 8,000,000 + profit 1,200,000 | (9,200,000) |
| **Difference (must be zero)** | **0** |

## 9. Cash flow

| Item | Amount (YER) |
|---|---:|
| Opening balance | 8,000,000 |
| Operating: collections 2,500,000 − supplier 1,000,000 − salaries 300,000 − subcontractor 800,000 − cement 200,000 | 200,000 |
| Investing: mixer purchase | (6,000,000) |
| **Closing balance** | **2,200,000** |

## 10. Year-end close (`CLS-2026`)

| Account | Debit | Credit |
|---|---|---:|
| Services `41102` | 2,500,000 | |
| Salaries `52101` | | 300,000 |
| Sundry `52301` | | 800,000 |
| Depreciation `52601` | | 200,000 |
| Retained earnings `32101` | | 1,200,000 |
| **Total** | **2,500,000** | **2,500,000** |

After close: trial balance 9,400,000 ✓.

## 11. Comparison & error-spotting checklist

1. (Receivables) Customer and supplier are zero after full collection and payment — any balance means a missing receipt.
2. (Accumulated) 200,000 credit for two months — running one month only leaves 100,000 and inflates profit by 100,000.
3. (Inventory) 1,200,000 includes cash cement — cash purchases enter inventory, not straight to expense.
4. Common mistake: expensing the mixer directly — turns a 1,200,000 profit into a 4,800,000 loss and hides the asset.
5. The won tender with no billing: a quotation alone creates no revenue — revenue comes only from the posted billing.

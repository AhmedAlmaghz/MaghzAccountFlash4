# Example 05 — Afaq Consulting (services, payroll & provisions)

> A no-inventory services company: a lead converted to a customer, service invoices, an engineer advance, remitted deductions, a Gross-up run, and IAS 19 provisions — then close.

## 1. Company card

| Item | Value |
|---|---|
| Name | Afaq Consulting Co. |
| Base currency | YER |
| Tax jurisdiction | `YE` |

## 2. Master data

### Boxes, customers, employees

| Entry | Detail |
|---|---|
| Cash box | `CB-MAIN` ← `11101` |
| Customer | Business Group (credit — converted from the "Business Group" lead) |
| Employees | Eng. Sami (engineer — advance 100,000), Ms. Lina (consultant) |

### Service items (Inventory ← Products — service type, no stock tracking)

| Item | Account |
|---|---|
| Management consulting (hour) | `41102` |
| Training course (trainee) | `41102` |

> Services carry no warehouse and no cost of sales — their invoices are pure revenue matched by staff effort (salaries).

## 3. Opening balance (01-01)

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 2,000,000 | |
| Capital `31101` | | 2,000,000 |

## 4. Dated transactions

| Date | Screen | Transaction | Amount (YER) |
|---|---|---|---:|
| 01-05 | Sales invoice | Credit services (consulting + training) | 1,500,000 |
| 01-12 | Receipt voucher | Partial collection, linked | 1,000,000 |
| 01-15 | Employee advance | Advance to engineer (outstanding) | 100,000 |
| 01-25 | Payroll run | Gross 600,000, deductions 60,000, net 540,000 | — |
| 01-26 | Payment voucher | Net salaries paid | 540,000 |
| 01-27 | Payment voucher | Remit deductions to authorities | 60,000 |
| 01-28 | Payment voucher | Rent in cash | 120,000 |
| 01-29 | End of service | Accrual on approval | 80,000 |
| 01-31 | Provision | Leave provision (true-up) | 30,000 |

## 5. Full solution — posted entries

| Ref | Description | Debit | Credit |
|---|---|---|---|
| OPEN | Opening | 2,000,000 | 2,000,000 |
| S-01 | Services: `11201` / `41102` | 1,500,000 | 1,500,000 |
| R-01 | Collection: `11101` / `11201` | 1,000,000 | 1,000,000 |
| AD-01 | Advance: `11202` / `11101` | 100,000 | 100,000 |
| PY-01 | Run: `52101` 600,000 / `21501` 540,000 / `21502` 60,000 | 600,000 | 600,000 |
| PY-02 | Net payment: `21501` / `11101` | 540,000 | 540,000 |
| TX-01 | Remit deductions: `21502` / `11101` | 60,000 | 60,000 |
| X-01 | Rent: `52201` / `11101` | 120,000 | 120,000 |
| EOS-01 | Accrual: `52501` / `21503` | 80,000 | 80,000 |
| LV-01 | Leave provision: `52101` 30,000 / `21504` | 30,000 | 30,000 |

## 6. Trial balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` (2,000,000 + 1,000,000 − 100,000 − 540,000 − 60,000 − 120,000) | 2,180,000 | |
| Customers `11201` (1,500,000 − 1,000,000) | 500,000 | |
| Employee advances `11202` | 100,000 | |
| EOS payable `21503` | | 80,000 |
| Leave provision `21504` | | 30,000 |
| Capital `31101` | | 2,000,000 |
| Services `41102` | | 1,500,000 |
| Salaries `52101` (600,000 + 30,000) | 630,000 | |
| Rent `52201` | 120,000 | |
| EOS expense `52501` | 80,000 | |
| **Total** | **3,610,000** | **3,610,000** |

> `21501` and `21502` are zero after payment and remittance — any balance means a missing step.

## 7. Income statement

| Item | Amount (YER) |
|---|---:|
| Service revenue | 1,500,000 |
| Salaries (600,000 + provision 30,000) | (630,000) |
| Rent | (120,000) |
| End of service | (80,000) |
| **Net profit** | **670,000** |

## 8. Balance sheet

| Item | Amount (YER) |
|---|---:|
| Cash 2,180,000 + customers 500,000 + advances 100,000 | 2,780,000 |
| EOS 80,000 + leave provision 30,000 | (110,000) |
| Capital 2,000,000 + profit 670,000 | (2,670,000) |
| **Difference (must be zero)** | **0** |

## 9. Cash flow

| Item | Amount (YER) |
|---|---:|
| Opening balance | 2,000,000 |
| Receipts (collection 1,000,000) | 1,000,000 |
| Payments (advance 100,000 + salaries 540,000 + deductions 60,000 + rent 120,000) | (820,000) |
| **Closing balance** | **2,180,000** |

## 10. Year-end close (`CLS-2026`)

| Account | Debit | Credit |
|---|---|---:|
| Services `41102` | 1,500,000 | |
| Salaries `52101` | | 630,000 |
| Rent `52201` | | 120,000 |
| EOS expense `52501` | | 80,000 |
| Retained earnings `32101` | | 670,000 |
| **Total** | **1,500,000** | **1,500,000** |

After close: trial balance 2,780,000 ✓.

## 11. Comparison & error-spotting checklist

1. (`21501`) zero after payment and (`21502`) zero after remittance — any balance means a missing step.
2. (Advances) 100,000 is an asset — expensing it inflates expenses and hides the staff right.
3. Profit 670,000: 700,000 means the leave provision was forgotten.
4. Common mistake: running payroll at net (540,000) as expense instead of gross — hides deductions.
5. The converted lead with no invoice: an invoice appearing for it means a phantom invoice — conversion alone creates no revenue.

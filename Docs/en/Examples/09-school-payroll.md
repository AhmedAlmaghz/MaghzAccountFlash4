# Example 09 — Al-Mustaqbal Schools (payroll, EOS & purchases)

> Payroll-heavy with a teacher advance and remitted deductions, an EOS accrual then partial payment, a leave provision, and credit stationery bought and paid — then close.

## 1. Company card

| Item | Value |
|---|---|
| Name | Al-Mustaqbal Private Schools |
| Base currency | YER |
| Tax jurisdiction | `YE` |

## 2. Master data

| Entry | Detail |
|---|---|
| Cash box | `CB-SCHOOL` ← `11101` |
| Customers | Parents (cash) |
| Supplier | Stationery supplier (credit) |
| Employees | Mr. Saeed (teacher — advance 80,000), Ms. Fatima (accountant), Uncle Hamed (guard) |
| Service items | Tuition fees / transport fees (`41102`) |

## 3. Opening balance (01-01)

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 5,000,000 | |
| Capital `31101` | | 5,000,000 |

## 4. Dated transactions

| Date | Screen | Transaction | Amount (YER) |
|---|---|---|---:|
| 01-05 | Sales invoice | Tuition fees in cash | 3,000,000 |
| 01-10 | Employee advance | Advance to teacher (outstanding) | 80,000 |
| 01-25 | Payroll run | Gross 1,200,000, deductions 120,000, net 1,080,000 | — |
| 01-26 | Payment voucher | Net salaries paid | 1,080,000 |
| 01-27 | Payment voucher | Remit deductions to authorities | 120,000 |
| 01-28 | End of service | Accrue 150,000 on approval | 150,000 |
| 01-29 | Payment voucher | Partial EOS payment (from a linked box) | 100,000 |
| 01-30 | Provision | Leave provision | 40,000 |
| 02-02 | Purchase invoice | Stationery on credit (`52301`) | 60,000 |
| 02-05 | Payment voucher | Pay the stationery supplier | 60,000 |
| 02-08 | Payment voucher | Rent in cash | 200,000 |

## 5. Full solution — posted entries

| Ref | Description | Debit | Credit |
|---|---|---|---|
| OPEN | Opening | 5,000,000 | 5,000,000 |
| S-01 | Fees: `11101` / `41102` | 3,000,000 | 3,000,000 |
| AD-01 | Advance: `11202` / `11101` | 80,000 | 80,000 |
| PY-01 | Run: `52101` 1,200,000 / `21501` 1,080,000 / `21502` 120,000 | 1,200,000 | 1,200,000 |
| PY-02 | Net payment: `21501` / `11101` | 1,080,000 | 1,080,000 |
| TX-01 | Remit deductions: `21502` / `11101` | 120,000 | 120,000 |
| EOS-01 | Accrual: `52501` / `21503` | 150,000 | 150,000 |
| EOS-02 | Partial payment: `21503` / `11101` | 100,000 | 100,000 |
| LV-01 | Provision: `52101` 40,000 / `21504` | 40,000 | 40,000 |
| P-01 | Stationery: `52301` / `21101` | 60,000 | 60,000 |
| V-01 | Pay supplier: `21101` / `11101` | 60,000 | 60,000 |
| X-01 | Rent: `52201` / `11101` | 200,000 | 200,000 |

## 6. Trial balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` (5,000,000 + 3,000,000 − 80,000 − 1,080,000 − 120,000 − 100,000 − 60,000 − 200,000) | 6,360,000 | |
| Employee advances `11202` | 80,000 | |
| EOS payable `21503` (150,000 − 100,000) | | 50,000 |
| Leave provision `21504` | | 40,000 |
| Capital `31101` | | 5,000,000 |
| Services `41102` | | 3,000,000 |
| Salaries `52101` (1,200,000 + 40,000) | 1,240,000 | |
| Rent `52201` | 200,000 | |
| Sundry (stationery) `52301` | 60,000 | |
| EOS expense `52501` | 150,000 | |
| **Total** | **8,090,000** | **8,090,000** |

> `21501`, `21502`, and the supplier are zero after payment and remittance — any balance means a missing step.

## 7. Income statement

| Item | Amount (YER) |
|---|---:|
| Tuition fees | 3,000,000 |
| Salaries (1,200,000 + provision 40,000) | (1,240,000) |
| End of service | (150,000) |
| Rent 200,000 + stationery 60,000 | (260,000) |
| **Net profit** | **1,350,000** |

## 8. Balance sheet

| Item | Amount (YER) |
|---|---:|
| Cash 6,360,000 + advances 80,000 | 6,440,000 |
| EOS 50,000 + provision 40,000 | (90,000) |
| Capital 5,000,000 + profit 1,350,000 | (6,350,000) |
| **Difference (must be zero)** | **0** |

## 9. Cash flow

| Item | Amount (YER) |
|---|---:|
| Opening balance | 5,000,000 |
| Receipts (fees 3,000,000) | 3,000,000 |
| Payments (advance 80,000 + salaries 1,080,000 + deductions 120,000 + EOS 100,000 + supplier 60,000 + rent 200,000) | (1,640,000) |
| **Closing balance** | **6,360,000** |

## 10. Year-end close (`CLS-2026`)

| Account | Debit | Credit |
|---|---|---:|
| Services `41102` | 3,000,000 | |
| Salaries `52101` | | 1,240,000 |
| Rent `52201` | | 200,000 |
| Sundry `52301` | | 60,000 |
| EOS expense `52501` | | 150,000 |
| Retained earnings `32101` | | 1,350,000 |
| **Total** | **3,000,000** | **3,000,000** |

After close: trial balance 6,440,000 ✓.

## 11. Comparison & error-spotting checklist

1. **Built-in drill:** in your copy change cash to 6,460,000 (+100,000) — a 100,000 equation gap exposes the error instantly.
2. (`21503`) 50,000 credit for the remainder — zeroing it means recording full payment by mistake.
3. (Advances) 80,000 is an asset — deducting it from salary without an advance entry hides the right.
4. EOS is paid through the cash box only — flipping status manually without a voucher leaves cash overstated.
5. Common mistake: paying gross (1,200,000) instead of net — overstates payments by 120,000 and hides deductions.

# Example 09 — Al-Mustaqbal Schools (payroll & end of service)

> Payroll-heavy: a 1,200,000 run, an EOS accrual then **partial payment** (`21503` stays 50,000 credit), and a leave provision. Salaries are always paid net.

## Company card

| Item | Value |
|---|---|
| Name | Al-Mustaqbal Private Schools |
| Base currency | YER |
| Tax jurisdiction | `YE` |

## Opening balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 5,000,000 | |
| Capital `31101` | | 5,000,000 |

## Transactions

| # | Transaction | Amount (YER) |
|---|---|---:|
| 1 | Tuition fees in cash (services `41102`) | 3,000,000 |
| 2 | Payroll run: gross 1,200,000, deductions 120,000, net 1,080,000 | — |
| 3 | Net salaries paid | 1,080,000 |
| 4 | End-of-service accrual (approval) | 150,000 |
| 5 | End-of-service paid in cash (partial) | 100,000 |
| 6 | Leave provision | 40,000 |
| 7 | Rent in cash | 200,000 |

## Full solution — posted entries

| Ref | Description | Debit | Credit |
|---|---|---|---|
| OPEN | Opening | 5,000,000 | 5,000,000 |
| S-01 | Fees: `11101` / `41102` | 3,000,000 | 3,000,000 |
| PY-01 | Run: `52101` 1,200,000 / `21501` 1,080,000 / `21502` 120,000 | 1,200,000 | 1,200,000 |
| PY-02 | Net payment: `21501` / `11101` | 1,080,000 | 1,080,000 |
| EOS-01 | Accrual: `52501` / `21503` | 150,000 | 150,000 |
| EOS-02 | Partial payment: `21503` / `11101` | 100,000 | 100,000 |
| LV-01 | Provision: `52101` 40,000 / `21504` | 40,000 | 40,000 |
| X-01 | Rent: `52201` / `11101` | 200,000 | 200,000 |

## Trial balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 6,620,000 | |
| Deductions payable `21502` | | 120,000 |
| EOS payable `21503` (150,000 − 100,000) | | 50,000 |
| Leave provision `21504` | | 40,000 |
| Capital `31101` | | 5,000,000 |
| Services `41102` | | 3,000,000 |
| Salaries `52101` (1,200,000 + 40,000) | 1,240,000 | |
| Rent `52201` | 200,000 | |
| EOS expense `52501` | 150,000 | |
| **Total** | **8,210,000** | **8,210,000** |

## Income statement

| Item | Amount (YER) |
|---|---:|
| Tuition fees | 3,000,000 |
| Salaries (1,200,000 + provision 40,000) | (1,240,000) |
| End of service | (150,000) |
| Rent | (200,000) |
| **Net profit** | **1,410,000** |

## Balance sheet

| Item | Amount (YER) |
|---|---:|
| Cash | 6,620,000 |
| Deductions 120,000 + EOS 50,000 + provision 40,000 | (210,000) |
| Capital 5,000,000 + profit 1,410,000 | (6,410,000) |
| **Difference (must be zero)** | **0** |

## Cash flow

| Item | Amount (YER) |
|---|---:|
| Opening balance | 5,000,000 |
| Receipts (fees 3,000,000) | 3,000,000 |
| Payments (salaries 1,080,000 + EOS 100,000 + rent 200,000) | (1,380,000) |
| **Closing balance** | **6,620,000** |

## Comparison & error-spotting checklist

1. **Built-in drill:** in your copy change cash to 6,720,000 (+100,000) and recompute the equation — a 100,000 gap exposes the error instantly. That is how the balance-sheet equation serves as a permanent error detector.
2. `21503` credit 50,000 (unpaid remainder): zeroing it means recording the payment in full by mistake.
3. EOS is paid **through the cash box only** — flipping status to paid manually without a payment voucher leaves cash overstated.
4. Common mistake: paying gross salaries (1,200,000) instead of net — overstates payments by 120,000 and hides deductions.

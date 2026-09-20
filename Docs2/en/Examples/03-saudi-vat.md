# Example 03 — Riyadh Trading (15% VAT & VAT return)

> Saudi company (`SA`): master data (box, customer, supplier, employee with advance, products, warehouse, lead), input `21302` split from output `21301`, linked collection and payment, and a leg-based return with a refundable balance.

## 1. Company card

| Item | Value |
|---|---|
| Name | Riyadh Trading Co. |
| Base currency | SAR (figures in Saudi Riyal) |
| Tax jurisdiction | `SA` — 15% |

## 2. Master data

### Boxes, customers, suppliers, employees

| Entry | Detail |
|---|---|
| Cash box | `CB-MAIN` ← `11101` |
| Customer | Al-Riyadh Establishment (credit) |
| Supplier | Gulf Supplier (credit) |
| Employee | Fahad Al-Otaibi — salesman (advance due 30,000) |

### Products & warehouse

| Product | Unit | Barcode |
|---|---|---|
| 32" screens | Piece / carton × 4 | 628100300001 |

| Warehouse | Location |
|---|---|
| Riyadh Main | Riyadh |

### Lead (CRM ← Leads)

| Lead | Status |
|---|---|
| Al-Mustaqbal Co. | New — converted to customer (no invoice yet in this example) |

## 3. Opening balance (01-01)

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 3,000,000 | |
| Capital `31101` | | 3,000,000 |

## 4. Dated transactions

| Date | Screen | Transaction | Amount (SAR) |
|---|---|---|---:|
| 01-04 | Purchase invoice | Credit 2,000,000 + tax 300,000 | 2,300,000 |
| 01-07 | Sales invoice | Credit 2,000,000 + tax 300,000 (cost 1,200,000) | 2,300,000 |
| 01-12 | Receipt voucher | Partial collection linked to invoice | 2,000,000 |
| 01-15 | Sales return | 200,000 + tax 30,000 (cost 120,000) | 230,000 |
| 01-18 | Purchase return | 100,000 + tax 15,000 | 115,000 |
| 01-20 | Payment voucher | Pay supplier linked to invoice | 1,000,000 |
| 01-25 | Payment vouchers | Rent 100,000 + salaries 250,000 | 350,000 |
| 01-28 | Employee advance | Advance to salesman (outstanding at close) | 30,000 |

## 5. Full solution — posted entries

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
| V-02 | Pay supplier: `21101` / `11101` | 1,000,000 | 1,000,000 |
| X-01/02 | Rent and salaries in cash | 350,000 | 350,000 |
| AD-01 | Advance: `11202` / `11101` | 30,000 | 30,000 |

## 6. Trial balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` (3,000,000 + 2,000,000 − 1,000,000 − 350,000 − 30,000) | 3,620,000 | |
| Customers `11201` (2,300,000 − 2,000,000 − 230,000) | 70,000 | |
| Employee advances `11202` | 30,000 | |
| Inventory `11301` | 820,000 | |
| Suppliers `21101` (2,300,000 − 115,000 − 1,000,000) | | 1,185,000 |
| Output VAT `21301` (300,000 − 30,000) | | 270,000 |
| Input VAT `21302` (300,000 − 15,000) | 285,000 | |
| Capital `31101` | | 3,000,000 |
| Sales `41101` | | 2,000,000 |
| Sales returns `41103` | 200,000 | |
| COGS `51101` | 1,080,000 | |
| Salaries `52101` | 250,000 | |
| Rent `52201` | 100,000 | |
| **Total** | **6,455,000** | **6,455,000** |

## 7. VAT return (correct solution)

| Item | Amount (SAR) |
|---|---:|
| Net output (300,000 − 30,000) | 270,000 |
| Net input (300,000 − 15,000) | 285,000 |
| **Net: (15,000) refundable balance carried forward — no cash payment** | **(15,000)** |

## 8. Income statement

| Item | Amount (SAR) |
|---|---:|
| Net sales (2,000,000 − 200,000) | 1,800,000 |
| Cost of sales (1,200,000 − 120,000) | (1,080,000) |
| **Gross profit** | **720,000** |
| Rent + salaries | (350,000) |
| **Net profit** | **370,000** |

## 9. Balance sheet

| Item | Amount (SAR) |
|---|---:|
| Cash 3,620,000 + customers 70,000 + advances 30,000 + inventory 820,000 + recoverable input 285,000 | 4,825,000 |
| Suppliers 1,185,000 + output due 270,000 | (1,455,000) |
| Capital 3,000,000 + profit 370,000 | (3,370,000) |
| **Difference (must be zero)** | **0** |

## 10. Cash flow

| Item | Amount (SAR) |
|---|---:|
| Opening balance | 3,000,000 |
| Receipts (collection 2,000,000) | 2,000,000 |
| Payments (supplier 1,000,000 + rent 100,000 + salaries 250,000 + advance 30,000) | (1,380,000) |
| **Closing balance** | **3,620,000** |

## 11. Year-end close (`CLS-2026`)

| Account | Debit | Credit |
|---|---|---:|
| Sales `41101` | 2,000,000 | |
| Sales returns `41103` | | 200,000 |
| COGS `51101` | | 1,080,000 |
| Salaries `52101` | | 250,000 |
| Rent `52201` | | 100,000 |
| Retained earnings `32101` | | 370,000 |
| **Total** | **2,000,000** | **2,000,000** |

After close: trial balance 4,825,000 (`21302` stays as a current asset 285,000 — close zeroes income and expenses only ✓).

## 12. Comparison & error-spotting checklist

1. (Return) Net (15,000) refundable: paying means output was summed without deducting returns and input.
2. (Suppliers) 1,185,000 = 2,300,000 − 115,000 − 1,000,000 — 2,185,000 means the linked payment was forgotten.
3. (Advances) 30,000 is a current asset — expensing it inflates expenses and hides the right.
4. (Customers) Only 70,000 — anything higher means a missing collection or return.
5. Common mistake: the return from header `vat_amount` fields instead of legs — identical here, divergent once later discounts appear.

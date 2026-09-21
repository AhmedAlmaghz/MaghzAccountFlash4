# Example 04 — Al-Noor Juice Factory (work orders & production cost)

> Full cycle: master data (BOM `BOM-01`, materials and FG warehouses, production supervisor), materials purchase, issue to order, labor, completion with finished receipt, purchase return, linked supplier payment, finished sale — then close.

## 1. Company card

| Item | Value |
|---|---|
| Name | Al-Noor Juice Factory |
| Base currency | YER |
| Tax jurisdiction | `YE` |

## 2. Master data

### Boxes, customers, suppliers, employees

| Entry | Detail |
|---|---|
| Cash box | `CB-FACT` ← `11101` |
| Customer | Al-Tawfeer Markets (credit) |
| Suppliers | Materials supplier + spare-parts supplier |
| Employee | Hassan Mushref — production supervisor |

### Products & warehouses

| Product | Type | Unit | Barcode |
|---|---|---|---|
| Mango concentrate (raw) | RAW | Kg / sack × 25 | 625400400001 |
| Sugar (raw) | RAW | Kg / sack × 50 | 625400400002 |
| Empty bottles (raw) | RAW | Piece / carton × 100 | 625400400003 |
| Mango juice 1L (finished) | FG | Bottle / carton × 12 | 625400400010 |

| Warehouse | Purpose |
|---|---|
| Materials warehouse | Work-order issues |
| Finished warehouse | Production receipts |

### Bill of materials `BOM-01` (mango juice — batch = 10 bottles)

| Material | Qty per batch |
|---|---|
| Mango concentrate | 5 kg |
| Sugar | 2 kg |
| Empty bottles | 10 pieces |

## 3. Opening balance (01-01)

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 4,000,000 | |
| Inventory (materials) `11301` | 1,000,000 | |
| Capital `31101` | | 5,000,000 |

## 4. Dated transactions

| Date | Screen | Transaction | Amount (YER) |
|---|---|---|---:|
| 01-04 | Purchase invoice | Materials on credit | 500,000 |
| 01-06 | Start work order | `WO-0001` (3 batches): issue 400,000 of materials | 400,000 |
| 01-08 | Payment voucher | Production labor in cash (`53101`) | 100,000 |
| 01-10 | Complete order | Receive 500,000 of finished goods into FG warehouse | 500,000 |
| 01-12 | Sales invoice | Cash sale of finished goods 700,000 (cost 300,000) | 700,000 |
| 01-15 | Purchase return | Damaged materials | 50,000 |
| 01-18 | Payment voucher | Pay supplier, linked | 300,000 |
| 01-20 | Payment voucher | Admin salaries | 200,000 |
| 01-22 | Payment voucher | Spare parts in cash (`52301`) | 60,000 |

## 5. Full solution — posted entries

| Ref | Description | Debit | Credit |
|---|---|---|---|
| OPEN | Opening | 5,000,000 | 5,000,000 |
| P-01 | Materials: `11301` / `21101` | 500,000 | 500,000 |
| W-START | Issue: `11302` / `11301` | 400,000 | 400,000 |
| W-LAB | Labor: `53101` / `11101` | 100,000 | 100,000 |
| W-DONE | Completion: `11303` / `11302` 400,000 / `53101` 100,000 | 500,000 | 500,000 |
| S-01 | Finished sale: `11101` / `41101` | 700,000 | 700,000 |
| S-01C | Cost: `51101` / `11303` | 300,000 | 300,000 |
| PR-01 | Materials return: `21101` / `11301` | 50,000 | 50,000 |
| V-01 | Pay supplier: `21101` / `11101` | 300,000 | 300,000 |
| X-01 | Salaries: `52101` / `11101` | 200,000 | 200,000 |
| X-02 | Spare parts: `52301` / `11101` | 60,000 | 60,000 |

## 6. Trial balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` (4,000,000 − 100,000 + 700,000 − 300,000 − 200,000 − 60,000) | 4,040,000 | |
| Materials inventory `11301` (1,000,000 + 500,000 − 400,000 − 50,000) | 1,050,000 | |
| Finished inventory `11303` (500,000 − 300,000) | 200,000 | |
| Suppliers `21101` (500,000 − 50,000 − 300,000) | | 150,000 |
| Capital `31101` | | 5,000,000 |
| Sales `41101` | | 700,000 |
| COGS `51101` | 300,000 | |
| Salaries `52101` | 200,000 | |
| Spare parts `52301` | 60,000 | |
| **Total** | **5,850,000** | **5,850,000** |

> `11302` and `53101` are zero after completion — dissolved into finished cost.

## 7. Income statement

| Item | Amount (YER) |
|---|---:|
| Sales | 700,000 |
| Cost of sales | (300,000) |
| **Gross profit** | **400,000** |
| Salaries 200,000 + spare parts 60,000 | (260,000) |
| **Net profit** | **140,000** |

## 8. Balance sheet

| Item | Amount (YER) |
|---|---:|
| Cash 4,040,000 + materials 1,050,000 + finished 200,000 | 5,290,000 |
| Suppliers | (150,000) |
| Capital 5,000,000 + profit 140,000 | (5,140,000) |
| **Difference (must be zero)** | **0** |

## 9. Cash flow

| Item | Amount (YER) |
|---|---:|
| Opening balance | 4,000,000 |
| Receipts (finished sale 700,000) | 700,000 |
| Payments (labor 100,000 + supplier 300,000 + salaries 200,000 + parts 60,000) | (660,000) |
| **Closing balance** | **4,040,000** |

## 10. Year-end close (`CLS-2026`)

| Account | Debit | Credit |
|---|---|---:|
| Sales `41101` | 700,000 | |
| COGS `51101` | | 300,000 |
| Salaries `52101` | | 200,000 |
| Spare parts `52301` | | 60,000 |
| Retained earnings `32101` | | 140,000 |
| **Total** | **700,000** | **700,000** |

After close: trial balance 5,290,000 ✓ (income accounts zero).

## 11. Comparison & error-spotting checklist

1. (Manufacturing) `11302` zero after completion — 400,000 means an uncompleted order.
2. (Suppliers) 150,000 = 500,000 − 50,000 − 300,000 — anything else means a missing return or payment.
3. (Cost) Finished goods sell at frozen cost 300,000 — never a later average.
4. `53101` zero: a debit remainder means labor bypassed the order (direct expense instead of capitalization).
5. Common mistake: starting an order without enough stock — the gate refuses the issue with a detailed shortage message.

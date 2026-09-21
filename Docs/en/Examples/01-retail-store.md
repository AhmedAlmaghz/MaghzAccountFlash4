# Example 01 — Al-Amana Store (full trading cycle)

> Yemeni company (`YE` — no VAT): complete master data (cash box, customers, supplier, employee, products with units, warehouse), then credit purchase and its payment, cash and credit sales, collection, return, a fixed asset with depreciation, and expenses — then year-end close.

## 1. Company card

| Item | Value |
|---|---|
| Name | Al-Amana Store |
| Base currency | YER |
| Tax jurisdiction | `YE` (zero-rated) |
| Valuation method | Moving average |

## 2. Master data (enter first in the system)

### Cash boxes (Settings ← Cash Boxes)

| Box | Ledger account | Custodian |
|---|---|---|
| `CB-MAIN` Main box | `11101` | Cashier |

### Customers (Sales ← Customers)

| Customer | Type | Opening balance |
|---|---|---:|
| Walk-in (cash) | Cash | 0 |
| Al-Noor Establishment | Credit | 0 |

### Suppliers (Purchases ← Suppliers)

| Supplier | Opening balance |
|---|---:|
| United Supply Co. | 0 |

### Employees (HR ← Employees)

| Employee | Role | Monthly base |
|---|---|---:|
| Ahmed Al-Haddad | Cashier | 300,000 |

### Products & units (Inventory ← Products)

| Product | Base unit | Alternate units (factor) | Barcode |
|---|---|---|---|
| Sugar 50kg | Bag | Carton × 20 | 625100100001 |
| Oil 18L | Jerry | Carton × 6 | 625100100002 |
| Tea 450g | Box | Dozen × 12 | 625100100003 |

### Warehouses (Inventory ← Warehouses)

| Warehouse | Branch |
|---|---|
| Main — Aden | Head branch |

## 3. Opening balance (01-01)

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 5,000,000 | |
| Inventory `11301` | 2,000,000 | |
| Capital `31101` | | 7,000,000 |

## 4. Dated transactions (drafts, then post)

| Date | Screen | Transaction | Amount (YER) |
|---|---|---|---:|
| 01-03 | Purchase invoice | Credit purchase from the supplier (goods) | 1,500,000 |
| 01-05 | Sales invoice | Cash sale (cost 1,200,000) | 2,000,000 |
| 01-08 | Sales invoice | Credit sale to Al-Noor (cost 480,000) | 800,000 |
| 01-12 | Receipt voucher | Partial collection from Al-Noor (linked to invoice) | 500,000 |
| 01-15 | Payment voucher | Rent in cash from `CB-MAIN` | 150,000 |
| 01-20 | Payment voucher | Salaries in cash | 300,000 |
| 01-22 | Sales return | From Al-Noor invoice (cost 60,000) | 100,000 |
| 01-25 | Payment voucher | Pay supplier (linked to purchase invoice) | 1,000,000 |
| 01-27 | Fixed asset | Buy display shelves in cash (`FA-0001`) | 600,000 |
| 01-31 | Depreciation | One month (60 months → 10,000) | 10,000 |

## 5. Full solution — posted entries

| Ref | Description | Debit | Credit |
|---|---|---|---|
| OPEN | Opening | 7,000,000 | 7,000,000 |
| P-01 | Purchase: `11301` / `21101` | 1,500,000 | 1,500,000 |
| S-01 | Cash sale: `11101` / `41101` | 2,000,000 | 2,000,000 |
| S-01C | Cost: `51101` / `11301` | 1,200,000 | 1,200,000 |
| S-02 | Credit sale: `11201` / `41101` | 800,000 | 800,000 |
| S-02C | Cost: `51101` / `11301` | 480,000 | 480,000 |
| R-01 | Collection: `11101` / `11201` | 500,000 | 500,000 |
| X-01 | Rent: `52201` / `11101` | 150,000 | 150,000 |
| X-02 | Salaries: `52101` / `11101` | 300,000 | 300,000 |
| SR-01 | Return: `41103` / `11201` | 100,000 | 100,000 |
| SR-01C | Cost reversal: `11301` / `51101` | 60,000 | 60,000 |
| V-01 | Pay supplier: `21101` / `11101` | 1,000,000 | 1,000,000 |
| FA-01 | Capitalize shelves: `12101` / `11101` | 600,000 | 600,000 |
| FA-02 | Depreciation: `52601` / `12102` | 10,000 | 10,000 |

## 6. Trial balance

| Account | Debit | Credit |
|---|---|---:|
| Cash `11101` | 5,450,000 | |
| Customers `11201` (800,000 − 500,000 − 100,000) | 200,000 | |
| Inventory `11301` | 1,880,000 | |
| Assets at cost `12101` | 600,000 | |
| Accumulated depreciation `12102` | | 10,000 |
| Suppliers `21101` (1,500,000 − 1,000,000) | | 500,000 |
| Capital `31101` | | 7,000,000 |
| Sales `41101` | | 2,800,000 |
| Sales returns `41103` | 100,000 | |
| COGS `51101` | 1,620,000 | |
| Salaries `52101` | 300,000 | |
| Rent `52201` | 150,000 | |
| Depreciation `52601` | 10,000 | |
| **Total** | **10,310,000** | **10,310,000** |

## 7. Income statement

| Item | Amount (YER) |
|---|---:|
| Net sales (2,800,000 − 100,000) | 2,700,000 |
| Cost of sales | (1,620,000) |
| **Gross profit** | **1,080,000** |
| Salaries 300,000 + rent 150,000 + depreciation 10,000 | (460,000) |
| **Net profit** | **620,000** |

## 8. Balance sheet

| Item | Amount (YER) |
|---|---:|
| Cash 5,450,000 + customers 200,000 + inventory 1,880,000 + net shelves 590,000 | 8,120,000 |
| Suppliers | (500,000) |
| Capital 7,000,000 + profit 620,000 | (7,620,000) |
| **Difference (must be zero)** | **0** |

## 9. Cash flow

| Item | Amount (YER) |
|---|---:|
| Opening balance | 5,000,000 |
| Operating: receipts 2,500,000 − payments (supplier 1,000,000 + rent 150,000 + salaries 300,000) | 1,050,000 |
| Investing: shelf purchase | (600,000) |
| **Closing balance** | **5,450,000** |

## 10. Year-end close (`CLS-2026`)

| Account | Debit | Credit |
|---|---|---:|
| Sales `41101` | 2,800,000 | |
| Sales returns `41103` | | 100,000 |
| COGS `51101` | | 1,620,000 |
| Salaries `52101` | | 300,000 |
| Rent `52201` | | 150,000 |
| Depreciation `52601` | | 10,000 |
| Retained earnings `32101` | | 620,000 |
| **Total** | **2,800,000** | **2,800,000** |

After close: post-close trial balance = 8,130,000 (debit: cash 5,450,000 + customers 200,000 + inventory 1,880,000 + shelves 600,000; credit: accumulated 10,000 + suppliers 500,000 + capital 7,000,000 + retained 620,000 ✓). All income accounts are zero.

## 11. Comparison & error-spotting checklist

1. (Chart) Net shelves 590,000 = 600,000 − 10,000 — 600,000 means depreciation was never run.
2. (Suppliers) 500,000 = 1,500,000 − 1,000,000 — 1,500,000 means the voucher never linked the invoice.
3. (Customers) 200,000 = 800,000 − 500,000 − 100,000 — anything else means a missing collection or return.
4. (Cash flow) Investing (600,000) is separate from operating — mixing them distorts operating flow.
5. Common mistake: entering the collection as a sales invoice — inflates revenue by 500,000 and leaves the customer debit.

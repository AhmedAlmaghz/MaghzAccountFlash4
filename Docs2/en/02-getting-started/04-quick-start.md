# Your First Complete Workflow — Quick Start

> From login to your first report: a product, a customer, a sales invoice with VAT, posting, collection, and then verifying the result.

## Overview

This guide walks you through a complete sales cycle step by step with a single connected numeric example from start to finish. Run it on Default Data or Demo Data the first time, and you will understand afterwards how the system's modules interconnect: Inventory ← Sales ← Accounting ← Reports.

**Our example:** you buy an item at a cost of 10,000 rials and sell it for 15,000 rials + 15% VAT.

## 1. Log In

1. Open the application and log in with the username `admin` and the admin password (the one you set in the Setup Wizard).
2. The Dashboard appears — your landing destination after every login.

## 2. Review the Essential Settings

Before the first invoice, verify three settings:

| What to review | Path | What to verify |
|---|---|---|
| Company Information | Sidebar ← Settings ← Company Information | The name, default currency (YER), tax number — they appear on invoices |
| Value Added Tax | Sidebar ← Settings ← Value Added Tax | The rate = 15% (the example in this guide assumes it) |
| Document Sequences | Sidebar ← Settings ← Document Sequences | The `INV-` prefix for invoices — every invoice takes a sequential number automatically |

## 3. Add a Product

1. Sidebar ← **Inventory** ← **Products**
2. Click the **Add Product** button.
3. Fill in the essential fields:

| Field | Value in our example | Note |
|---|---|---|
| Product name | "24-inch display screen" | Appears on invoices and in search |
| Product code | Generated automatically with the `PRD-` prefix if left empty | Or enter your own code |
| Cost price | **10,000** | Used for profit calculation and inventory valuation |
| Sale price | **15,000** | The suggested price when creating the invoice |

4. Save. The product now appears in the products list with a zero stock balance (you haven't bought yet — that's normal).

## 4. Add a Customer

1. Sidebar ← **Sales** ← **Customers**
2. Click the **Add Customer** button.
3. Enter: the name ("Al-Noor Trading Est."), the phone — the rest is optional.
4. Save. The customer gets a code with the `CUS-` prefix and is automatically linked to the **Accounts Receivable** account in the Chart of Accounts — this is the account that tracks its balance.

## 5. Create the Sales Invoice

1. Sidebar ← **Sales** ← **Sales Invoices**
2. Click the **New Invoice** button (visible to those with the `sales.create` permission).
3. Select the customer "Al-Noor Trading Est." from the customer list.
4. In the invoice lines, choose the product "24-inch display screen" and quantity **1** — the price is filled automatically from the sale price.
5. Review the calculation at the bottom of the invoice:

| Item | Calculation | Amount (YER) |
|---|---|---|
| Subtotal before tax | 1 × 15,000 | **15,000** |
| Value Added Tax 15% | 15,000 × 15% | **2,250** |
| Total due | 15,000 + 2,250 | **17,250** |

6. Choose the payment method: leave it as **credit** (or enter a down payment for mixed payment).
7. Save the invoice — it is created with the **Draft** status and number `INV-0001` approximately (depending on the sequence).

## 6. Post the Invoice

Open the (Draft) invoice and click the **Post** button. At the moment of posting, all of the following happens automatically:

| What happened? | Detail |
|---|---|
| **The Journal Entry was created** | Debit: Accounts Receivable (trade receivables) 17,250 — Credit: product sales 15,000 — Credit: Value Added Tax 2,250 |
| **Stock went out** | An outbound movement of quantity 1 for the product at a cost of 10,000 (feeds into Cost of Goods Sold) |
| **The customer's balance increased** | The customer's Accounts Receivable = 17,250 rials until you collect it |
| **Editing was locked** | The invoice became **Posted** — no editing of amounts |

> Notice the balance: Debit 17,250 = Credit 15,000 + 2,250. This is double-entry working automatically.

## 7. Partial Collection with a Receipt Voucher

The customer has now paid 10,000 out of 17,250:

1. Sidebar ← **Accounting** ← **Receipt Vouchers**
2. Click **New Receipt Voucher**.
3. Select the customer, and enter: the amount **10,000**, the payment method (cash) — the voucher is linked to the cash box/cash account.
4. Save and then **Post** the voucher.
5. The effect of posting: Debit: cash box/cash 10,000 — Credit: Accounts Receivable 10,000.
6. **The remaining balance on the customer:** 17,250 − 10,000 = **7,250 rials** — it appears automatically in their Customer Statement and receivables Aging.

## 8. Review the Reports

| Report | Path | What will you see in our example? |
|---|---|---|
| Customer Statement | Sidebar ← Reports ← Customer Statement | The customer's balance of **7,250** with the invoice and voucher details |
| Trial Balance | Sidebar ← Accounting ← Trial Balance | The balances of all accounts — Debit equals Credit |
| Income Statement | Sidebar ← Accounting ← Income Statement | Revenue 15,000 and Cost of Goods Sold 10,000 = gross profit 5,000 |
| Account Ledger | Sidebar ← Accounting ← Account Ledger | The Accounts Receivable account movements line by line |

## "Where Do I Verify the Result?" Table

| Result | Where to verify it | What you should see |
|---|---|---|
| The invoice is posted | Sales ← Sales Invoices | The "Posted" status next to `INV-0001` |
| Stock went out | Inventory ← Stock Movements | An outbound (out) movement of quantity 1 for the product |
| The customer's balance | Reports ← Customer Statement | 17,250 due, then 7,250 remaining after the voucher |
| The Journal Entry | Accounting ← Journal Entries | A balanced entry: Debit Accounts Receivable / Credit sales + VAT |
| Cash collected | Accounting ← Account Ledger (the cash/cash box account) | Debit 10,000 from the Receipt Voucher |
| Gross profit | Accounting ← Income Statement | Revenue 15,000 − cost 10,000 = 5,000 |
| VAT payable | Accounting ← Trial Balance (the tax account) | Credit 2,250 — which you owe to the tax authority |

## Common Errors in Your First Cycle

| Problem as shown | Cause | Solution |
|---|---|---|
| The "New Invoice" button is not visible | Your role lacks `sales.create` | Log in with a role that has the permission or request it from the administrator |
| The invoice doesn't appear in the Trial Balance | The invoice is still a Draft — it hasn't been posted | Open it and click "Post" — a Draft has no accounting effect |
| The product balance is zero after the sale | No quantity was entered into inventory (no purchase invoice or Opening Balance was created) | Create a purchase invoice from the Purchases module or a stock adjustment |
| The tax amount is 0 on the invoice | The VAT rate is not configured in Settings | Settings ← Value Added Tax ← set it to 15% |

## Tips

- Don't post the invoice before reviewing the amounts — posting locks editing, and correcting afterwards requires a reversing document (a sales return).
- Try the full cycle on **Demo Data** first — afterwards you can erase everything and start clean with your business data.
- Watch the "stock alert" message — if you sell more than you own, the system will warn you about the negative balance.
- Once you master this cycle, the reverse cycle (buying from a supplier) follows the same logic in the Purchases module.

# Solved Training Examples — User Guide

> 10 complete examples for diverse companies: each with a company card, opening balance, and transactions, then the **full solution** (entries, trial balance, income, balance sheet, cash flow) plus a comparison checklist for finding errors.

## How to use these examples

1. Create a new company in the system matching the example card (currency, tax jurisdiction, valuation method).
2. Enter the opening balance, then the transactions as **drafts**, posting them one by one.
3. Extract from the system: trial balance, income statement, balance sheet, cash flow (and aging where applicable).
4. Compare line by line with the "correct solution" in the file — any difference means an entry or posting error, and the checklist points to its location.

> All figures are **machine-verified**: every entry balances and the balance-sheet equation nets to zero in each example.

## Method of every example (a full system cycle)

Each example follows the same order: **(1)** master data (cash boxes linked to accounts, customers and suppliers, employees, products with units and barcodes, warehouses, plus a BOM or a lead where the business fits) ← **(2)** opening balance ← **(3)** dated transactions with screen paths (sales and purchase invoices, linked vouchers, returns, payroll runs, advances/custodies and their settlements, POS shifts, assets and depreciation) ← **(4)** posted entries ← **(5)** closing statements ← **(6)** the `CLS` closing entry with post-close trial balance ← **(7)** a comparison checklist against system screens.

## Element coverage map

| Element | Where it appears |
|---|---|
| Account-linked cash boxes | All examples (box table) + inter-box transfer (02) |
| Customers and suppliers with balances and settlements | All examples + customer-from-lead (03, 05, 10) |
| Employees, advances and custodies | 01, 03, 05, 07, 09, 10 |
| Products, units, barcodes and warehouses | 01, 02, 03, 04, 06, 07, 08, 10 |
| BOM and work orders | 04 |
| Sales and purchase invoices (cash and credit) | All examples |
| Vouchers linked to invoices | 01, 02, 03, 04, 05, 06, 07, 08, 09, 10 |
| Sales and purchase returns | 01, 02, 03, 04, 06, 10 |
| Payroll runs and provisions | 05, 09 (+ direct salaries elsewhere) |
| Fixed assets and depreciation | 01, 08 |
| POS shifts with automatic differences | 07 |
| `CLS` year-end close | All examples |
| Stock-free services | 05, 08, 09 |

## Index

| # | File | Company | Skill tested |
|---|---|---|---|
| 01 | [Retail store](./01-retail-store.md) | Al-Amana Store (YE) | Basic trading cycle, atomic posting, balance equation |
| 02 | [Import & FX](./02-import-fx.md) | Al-Ofok Import (USD) | Accrual at invoice rate, `-FX` entry, revaluation |
| 03 | [Saudi VAT](./03-saudi-vat.md) | Riyadh Trading (SA 15%) | Input/output split, refundable return |
| 04 | [Manufacturing](./04-manufacturing.md) | Al-Noor Juice Factory | Work orders, WIP, labor capitalization, WIP cleared on completion |
| 05 | [Services & payroll](./05-services-payroll.md) | Afaq Consulting | Gross-up entry, EOS and leave provisions |
| 06 | [Pharmacy FIFO](./06-pharmacy-fifo.md) | Al-Shifa Pharmacy | Layers, returns at frozen cost, shortage |
| 07 | [POS café](./07-cafe-pos.md) | Al-Diwan Café | Shifts, credit outside the drawer, automatic `POS-DIFF` |
| 08 | [Contracting & assets](./08-contracting-assets.md) | Modern Construction | Mandatory capitalization, depreciation, credit-natured contra |
| 09 | [School payroll](./09-school-payroll.md) | Al-Mustaqbal Schools | Net payment, partial EOS settlement, error-spotting drill |
| 10 | [Wholesale & credit](./10-wholesale-aging.md) | Al-Nokhba Wholesale | Discounts allowed, aging tied to receivables |

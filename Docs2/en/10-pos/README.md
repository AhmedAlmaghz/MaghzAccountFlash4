# Point of Sale (POS) — User Guide

> A hybrid cashier screen (barcode + touch) that creates real sales invoices posted instantly, with a thermal receipt and Cash Box shifts.

## Overview

The POS module is a fast-selling interface built for the cashier inside the store. Instead of opening the full Sales Invoices screen, the cashier works from a single full-screen page: scanning barcodes or tapping tiles, then taking cash and printing the receipt in seconds.

**When should you use POS instead of a regular sales invoice?**

| Criterion | POS | Regular sales invoice |
|---|---|---|
| Selling style | Instant sale in front of the customer | Sale by order / phone / contracts |
| Entry speed | Barcode or a single tap | A full form with many fields |
| Posting | Instant at payment — no Draft | Draft then manual posting |
| Numbering | `POS-` (6 zero-padded digits) | `INV-` |
| Printing | 80mm thermal receipt | A4 document |
| Shift linkage | Mandatory (every sale is linked to a Shift) | Not linked |
| Database table | The same `sales_invoices` table with `is_pos = true` + `shift_id` | The same table |

> **Key point:** a POS sale is not a "parallel system" — every sale creates a real sales invoice that appears in sales reports, aging, and the Income Statement exactly like any other invoice. The difference is only the interface and the speed of the cycle.

## Access & Permissions

- Required permissions: `pos.view` to view, `pos.create` to sell, `pos.edit` to edit, `pos.delete` to delete, plus `reports.view` and `reports.export` for POS reports.
- All pages are protected by `PermissionRoute` — a user without any `pos.*` permission never sees the module in the sidebar at all.

| Role | Access |
|---|---|
| `super_admin` | Everything |
| `admin` | All module pages and settings |
| `manager` | The terminal, shifts, and reports |
| `accountant` | Shifts and reports (to review cash differences) |
| `sales_rep` | The cashier screen (per their permissions) |
| `viewer` | View only |

## Page Map

| Page | Path | Description | Detailed guide |
|---|---|---|---|
| Cashier screen | `/pos` | A full-screen selling page outside the app shell (AppLayout) — no sidebar, no header, for full focus on selling | [01-terminal.md](./01-terminal.md) |
| Shifts | `/pos/shifts` | A log of every Shift for every cashier and Cash Box + the Z Report | [02-shifts.md](./02-shifts.md) |
| POS Settings | `/pos/settings` | The default Cash Box, the default Walk-in Customer, and behavior/print toggles | [03-settings-reports.md](./03-settings-reports.md) |
| POS Reports | `/pos/reports` | Sales analysis with filters, grouping, and export | [03-settings-reports.md](./03-settings-reports.md) |

> **Full screen:** the cashier screen (`/pos`) deliberately renders outside the app layout — the cashier does not need the sidebar, and a stray click there never pulls them out of the sale. The module's other pages (`/pos/shifts` and the rest) render inside the app shell as usual.

## Sale Lifecycle

1. **Open a Shift** — choose the Cash Box and enter the opening float in the drawer.
2. **Sell** — scan barcodes or tap tiles, then press Pay (F9).
3. **Take payment** — cash, credit, or mixed. The invoice is created, the Journal Entry posts, and stock is deducted in one atomic operation.
4. **Print the receipt** — automatic printing after payment (can be disabled) + reprinting the last receipt.
5. **Close the Shift** — count the drawer cash, the difference is computed, and the Z Report prints.

## Screens at a Glance


![Full-screen cashier terminal](../assets/pos/terminal.png)
### Cashier Screen (`/pos`)

- An open-shift prompt (Cash Box + opening float) on the first visit of the day.
- A touch grid of large tiles with a live stock badge, plus hardware barcode scanning through a unified search field.
- A locally persisted cart that survives refresh, plus held carts for serving several customers in rotation.
- A payment dialog with three modes (Cash / Credit / Mixed) and instant change calculation.

### Shifts (`/pos/shifts`)

- A log of every Shift: opening, closing, expected amount, and the **difference** (balanced / over / short, color-coded).
- A closing dialog with a physical count and a printable 80mm Z Report.

### Settings (`/pos/settings`)

- The default Cash Box, the default Walk-in Customer, and the receipt footer text.
- Behavior toggles: auto-print, price editing, discount, negative stock.

### Reports (`/pos/reports`)

- Ready periods (Today / Week / Month / Year / All) and filters (payment method, cashier, product, customer).
- Group by (day / shift / cashier / product / payment method) and Excel/PDF/HTML export.

## POS in the Bigger Picture

The module integrates automatically with the rest of the modules — no double entry at all:

| Integrated module | What is exchanged |
|---|---|
| **Sales** | Every POS sale is a full sales invoice (`is_pos = true`) appearing in invoice lists, sales reports, and the aging for the credit part |
| **Inventory** | Stock deduction and outbound movements happen in the same payment operation (from the warehouse richest in stock for each product) |
| **Accounting** | The Journal Entry posts instantly: the Cash Box (the drawer's GL account) + Accounts Receivable / Sales + output VAT |
| **Settings** | Currency, VAT rate, numbering (`POS-` from sequences), and the `pos.*` keys |
| **Reports Hub** | POS data feeds the central reports alongside regular sales |

## Quick Glossary

| Term | Meaning |
|---|---|
| **Shift** | The cashier's working period from opening the drawer until closing it — every sale is linked to it |
| **Cash Box** | The cash drawer linked to a GL account in the Chart of Accounts |
| **Walk-in Customer** | The default customer for pure cash sales, no card needed |
| **POS Receipt** | The 80mm thermal receipt, numbered `POS-` independently of `INV-` |
| **Z Report** | The Shift-closing report: sales, cash, expected amount, and the difference |

## Quick FAQ

| Question | Short answer |
|---|---|
| Does a POS sale appear in regular sales reports? | Yes — it is a real sales invoice flagged `is_pos` |
| Can you sell on credit to the Walk-in Customer? | No — credit requires a registered customer whose balance the amount is added to |
| Can one cashier open two shifts? | No — a rule enforced at the database level |
| Is a sale lost if power cuts briefly? | The cart is saved locally — it comes back after restart (an unfinished payment is redone) |
| Who can edit the selling price at the terminal? | Only a user with the permission, and only after enabling `pos.allowPriceEdit` (disabled by default) |

## Important Rules

- **No selling without an open Shift** — the cashier screen is locked until you open one, and only one Shift may be open per user (enforced at the database level).
- **Credit requires a registered customer** — a pure cash sale can go to the Walk-in Customer, but any credit portion is added to a real customer's balance.
- **Numbers are recomputed on the server** — totals and tax are computed from the invoice lines inside the operation itself; the total cannot be tampered with from the interface.
- **The cart is saved locally** — a page refresh or a brief outage never loses an in-progress sale (it is stored in `localStorage`).

## Common Errors & Fixes

| Message as shown in the system | Cause | Solution |
|---|---|---|
| "لا توجد ورديـة مفتوحة" (No open Shift) | The cashier has not opened a Shift yet | Click **Open Shift** and choose the Cash Box and opening float |
| "لديك ورديـة مفتوحة بالفعل" (You already have an open Shift) | Trying to open a second Shift for the same user | Close the current Shift first from the Shifts screen |
| "يلزم عميل مسجل للبيع الآجل" (A registered customer is required for credit sales) | Mixed or credit payment with no customer | Select a customer from the list before completing payment |
| "أُغلقت الوردية أثناء عملية الدفع" (The Shift was closed during checkout) | The Shift was closed from another device at the same moment | Open a new Shift and redo the payment |

## Tips

- Hold the cart with **F10** to serve the next customer quickly when the queue builds up.
- Set the "default Walk-in Customer" and "default Cash Box" once in Settings to speed up the daily Shift opening.
- Review the Shifts screen at the end of each day to make sure there are no large cash differences.

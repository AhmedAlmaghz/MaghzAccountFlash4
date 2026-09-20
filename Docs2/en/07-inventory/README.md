# Inventory — User Guide

> Complete management of the goods cycle: products and units, warehouses, balances, movements, transfers, and stock adjustments.

## Overview

The Inventory module is the heart of the system's perpetual inventory: every posted sales invoice ships goods out, every posted purchase invoice brings goods in, and every stock adjustment corrects the differences — all automatically and with an accompanying journal entry.

Access the module from: **Sidebar ← Inventory** (`/inventory`). The hub page shows navigation cards with live counters.

## Access & Permissions

| Action | Permission |
|---|---|
| View products, warehouses, balances, and movements | `inventory.view` |
| Add/edit a product, warehouse, transfer, or adjustment | `inventory.create` / `inventory.edit` |
| Delete | `inventory.delete` |
| Post a stock adjustment | `inventory.edit` (after prior approval) |

- All data is isolated per company (`company_id`) — you only see data for your active company.
- The `viewer` role is read-only, with no add or edit buttons.

## Inventory Hub Page

When you open `/inventory` you find main navigation cards, each showing a live counter:

| Card | Path | Live counter | Description |
|---|---|---|---|
| **Products** | `/inventory/products` | Total products | Manage products, categories, and prices |
| **Warehouses** | `/inventory/warehouses` | Number of warehouses | Warehouses and their branch links |
| **Stock** | `/inventory/stock` | Number of balance rows | Stock balances and transfers between warehouses |
| **Movements** | `/inventory/transactions` | Total quantity moved | In / out / adjustment / transfer movements |
| **Adjustments** | `/inventory/adjustments` | — | Stock counts and differences |
| **Low Stock Alert** | `/reports/low-stock-alert` | Number of low items | Report of items below the minimum threshold |

## Related Reports

From **Sidebar ← Reports Hub** you find the inventory reports:

| Report | Purpose |
|---|---|
| **Low Stock Alert** | Items whose balance has reached the minimum threshold or reorder point |
| **Item Ledger** | Detailed statement of a single item's movements over a period |
| **Stock Valuation** | The value of the entire inventory at cost: quantity × cost price — the three methods (average/FIFO/standard) are documented in `04-valuation.md` |

## Module Structure

```
Inventory
├── Products            ← Product card + multi-units + opening balance
├── Warehouses          ← Define warehouses + view each warehouse's stock
├── Stock               ← Balances + Transfers tab (TRF-)
├── Stock Movements     ← Log of all movements (in / out / adjustment / transfer)
├── Stock Adjustments   ← Stock counts and the approve/post cycle (ADJ-)
└── Valuation Methods   ← Moving average / FIFO / Standard + layers (`04-valuation.md`)
```

## Important Rules

| Rule | Details |
|---|---|
| Stock is in the Base Unit | All balances and movements are stored **in the Base Unit** — documents lock the conversion factor at creation time |
| Posting moves stock | Nothing changes in balances until the document is **posted** — drafts have no effect |
| Every movement has a journal entry | Posting automatically generates a **Journal Entry** (inventory / cost / count difference) |
| Balances cannot be edited manually | The balance changes only through a document: an invoice, a return, a transfer, an adjustment, or a simple manual movement |
| Isolated per warehouse | The balance is tracked for each (product × warehouse) pair separately |

## Common Errors & Fixes

| Message/Observation | Cause | Solution |
|---|---|---|
| The balance does not change after saving an invoice | The invoice is still a **Draft** | Post the invoice so stock moves and the journal entry is issued |
| The quantity appeared in the Base Unit although sold by the carton | Stock is always in the Base Unit | Normal — 2 cartons deduct 24 base units |
| Cannot delete the product's only unit | Every product must keep at least one Base Unit | Add another unit first, then delete |
| The transfer's "Complete" button is disabled | The transfer is complete or not a draft | Create a new transfer |
| Cannot post an adjustment | The difference is zero or the adjustment was not approved | Approve it first; a zero difference cannot be posted at all |

## Tips

- Start by defining **warehouses**, then **units** (in Settings), then **products** — the right order saves you rework.
- Enter the **Opening Balance** for each product once, at creation; it cannot be entered later from the same dialog.
- Check the **Low Stock Alert** card daily — the live counter reveals what needs a purchase order immediately.
- Use **transfers** to move goods between warehouses instead of adjustments — a transfer tracks both sides.
- Treat the **adjustment** as the last resort: for physical counts and counting errors, not for correcting document mistakes.

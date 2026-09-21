# Batch (A+B) Video Scripts — ready to record later

> Shooting scripts only (no video production). Each script: goal, shots, and the literal voice-over text. Target length 4–6 minutes per video.

## 15 — Financial Controls & Operation Restrictions

- **Goal:** convince the owner and accountant that the system protects the ledgers by itself.
- **Shots:** (1) a user without `accounting.post` presses Post ← rejection. (2) Unbalanced entry ← Post button disabled with the difference shown. (3) Posted invoice ← edit buttons disabled ← create a return for the difference. (4) Audit log showing all three actions.
- **Voice-over:** "Every financial operation in Maghz passes three gates: who is allowed, whether the operation is sound, and whether it is recorded and locked. The rep creates the draft, the accountant posts it, the manager locks the period — no single person combines creation, approval, and lock. And the rule to keep: posted is final; corrections go through a reversing document, never an edit."

## 16 — Year-End Close, Assets & Reversal

- **Goal:** close the year with confidence, manage assets, and fix mistakes.
- **Shots:** (1) Close preview for a trial year ← `CLS-YYYY` entry. (2) Attempting to post with a date inside the closed year ← rejection. (3) Creating an asset funded by a cash box ← monthly depreciation run ← asset card. (4) Reversing a posted voucher ← `REV-` reference and status flip.
- **Voice-over:** "A closed year is an archive: no new posting dated inside it, ever. And an asset is capitalized the moment it is created — a record without an entry means understated assets. A posted mistake is never edited or deleted — it is reversed."

## 17 — Tax Periods & the Return

- **Goal:** the return comes from entries, not invoices.
- **Shots:** (1) Jurisdiction card: pick `SA` ← live 15% rate. (2) Return panel for a month ← the six lines (output/its returns/input/its returns/net/54,000 due). (3) Close the period, then file ← posting inside it ← rejection.
- **Voice-over:** "Output tax lives in one account and input tax in another, and the return is computed from posted entry legs — because the tax field on the invoice header lies after later returns."

## 18 — Inventory Valuation & FX Differences

- **Goal:** an honest margin and a single-currency ledger.
- **Shots:** (1) Inventory policy card: switching between average, FIFO, and standard. (2) FIFO example: two layers, then a sale eating the oldest ← `-COGS` entry. (3) USD invoice ← computed base ← voucher linked at a different rate ← `-FX` entry. (4) Running revaluation ← `FX-YYYYMMDD`, then a second run with no entries.
- **Voice-over:** "Cost freezes at sale time, not entry time, and an invoice always accrues at its own rate — the difference is a separate entry. Revaluation is incremental with an anchor: a second run for the same date generates nothing."

## 19 — Tax Jurisdictions & Agent Memory

- **Goal:** regional expansion and batch confidence.
- **Shots:** (1) The four-country table and rates. (2) Changing jurisdiction ← a new invoice at the new rate + previously posted ones untouched. (3) "Record 50 invoices" request ← `ai.preview_batch` shows the plan ← approval ← progress card. (4) "Where did the batch get to?" ← answered from the task table.
- **Voice-over:** "Law is data, not code: a legislative update means editing one country file. And the assistant never forgets: your requests in full text and your task table live outside the chat window — one batch, one approval."

---

## Appendix: Screenshots Wanted (not yet captured — no fake images)

The new files above carry no image references on purpose (no broken links). When the app runs, capture the following in Arabic and English (place in `ar/assets/` and `en/assets/` under the same names):

| Screen | Path | File name |
|---|---|---|
| Year-end close (year preview) | `/accounting/year-end` | `accounting/year-end.png` |
| Fixed-asset register | `/accounting/fixed-assets` | `accounting/fixed-assets.png` |
| Posted-entry reversal dialog | `/accounting/journal` | `accounting/reverse-dialog.png` |
| VAT return panel | Settings ← Tax | `settings/vat-return.png` |
| Tax jurisdiction card | Settings ← Company | `settings/tax-jurisdiction.png` |
| Inventory policy card (valuation method) | Settings ← Company | `settings/inventory-valuation.png` |
| Revaluation section | Settings ← Currencies | `settings/fx-revaluation.png` |
| Batch approval card + progress card | `/ai` | `ai/batch-approval.png` |

After capturing: add `![...](../assets/...)` lines at the fitting spots in the new files, and update the "80 screenshots" count in `Docs2/README.md`.

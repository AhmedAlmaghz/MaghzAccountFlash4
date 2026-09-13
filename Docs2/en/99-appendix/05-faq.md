# Frequently Asked Questions

> Direct answers to the questions most often asked about the system's daily operation, with pointers to the detailed files.

## Journal Entries & Posting

### 1. Can I edit a posted journal entry?

No. Posting approves the entry permanently and locks it against editing — this is a core protection for the integrity of the books. Only Draft entries can be freely edited and deleted.

### 2. How do I correct a mistake after posting?

There is no hidden "undo" — correction is done with proper accounting:
- **Reversing entry**: create a new entry with the same amounts in the opposite direction (the debit becomes credit and vice versa), stating the reason in the description.
- **Return**: for mistakes in invoices or documents, record a sales return (`SR-`) or a purchase return (`PR-`) that cancels the original document's effect on inventory and accounts.
- Then re-enter the operation correctly. All of this remains recorded in the Audit Log.

### 3. What exactly happens when a sales invoice is posted?

Posting is one atomic operation that completes all of the following together:
1. The accounting **journal entry** is created (debit the customer/cash, credit revenue and tax).
2. **Inventory** is deducted from the warehouse specified on the invoice.
3. The **balances** of the customer and the accounts are updated.
4. The invoice is then locked against editing — any correction is made with a return.

## POS & Sales

### 4. When should I use POS instead of a sales invoice?

| Use POS when | Use a sales invoice when |
|---|---|
| A quick cash sale in front of the customer with barcode scanning | A credit sale to a registered customer with payment terms |
| A cashier on a shift with a cash box | An operation that needs quotations or complex price editing |
| A simple receipt numbered `POS-` | A formal document numbered `INV-` tied to a later collection process |

Both affect inventory and accounts with the same seriousness when posted.

### 5. Can a shift be open for every cashier?

Yes — each cashier has their own shift, opened with a cash box opening balance and closed with a Z Report showing the sales and the difference. Shifts are independent, and one cashier's Z Report never mixes with a colleague's sales. It is best not to share a single user account between two cashiers, so that shifts and any "own documents only" permission stay accurate.

### 6. Why did the cash invoice show as "paid" by itself?

Because it is correct: a cash invoice settles immediately, so the system records it as fully paid at the moment of posting, tied to the cash account. Do not create a Receipt Voucher for it afterwards, or you will collect twice.

## Inventory

### 7. Does deleting restore inventory?

- **Deleting a draft**: does not touch inventory at all (drafts were never posted and deducted nothing).
- **Reversing a posted document**: is not done by deletion (posted documents cannot be deleted) — it is done with a **return**, and returns do restore inventory to the warehouse.
- General rule: anything that deducted stock can only be corrected with a documented reverse movement (return/adjustment).

### 8. What is the difference between a product's "Type" and "Category"?

- **Product Type**: a single functional classification that determines how the system treats the product (raw material / semi-finished / finished product...) — it determines the item's path in purchases, sales, and manufacturing.
- **Category**: an organizational tool for display and reporting; a product can belong to more than one category (example: "Beverages" and "Imported" together).
- The product pages' filters use both, and the categories' share chart on the dashboard depends on the categories.

### 9. How do I set an opening balance?

When starting to use the system (or at the start of the year), enter the account balances (cash, bank, inventory, customer and supplier receivables/payables) via opening entries or the Opening Balance field in the dedicated screens, before recording regular transactions. Without them your reports (Balance Sheet, aging) will be incomplete. See the accounting file for the detailed steps.

## Currencies & Tax

### 10. Can I work with multiple currencies?

Yes. The base currency is the Yemeni Rial (YER) by default, and you can define other currencies (USD, SAR...) with exchange rates. Documents are recorded in their own currency, the **Base Currency Amount** is always computed server-side at the exchange rate, and the main reports are displayed in the base currency. See the multi-currency file.

### 11. How does the discount work with tax?

The standard calculation order: the **discount is applied first** to the subtotal, then **VAT** is computed on the net after the discount. Example: 100,000 YER with a 10% discount = 90,000, then 5% VAT = 4,500, so the total is 94,500 YER.

## Permissions & Access

### 12. Who sees what? (own explained)

- `module.view`: sees **all** of the company's documents in the module.
- `module.own`: sees **only their own documents** (example: a rep sees their own invoices).
- `super_admin`/`admin`: see everything. The sidebar automatically hides any module for which you hold no access permission — details in the permissions matrix file.

### 13. How do I clone a system role?

System (built-in) roles are read-only and cannot be edited. From Settings ← Roles (الأدوار), click the "Clone (نسخ)" button next to the role: a new role is created with the name "... - Copy" holding all of the original's permissions; edit it as you wish. This is how you build, for example, a "Purchases Accountant" starting from the accountant role without touching the original.

### 14. Where did my delete button go?

Buttons are hidden with the permission: if you do not hold `module.delete`, you will not see the button at all. And even with it, deletion is in practice for drafts only — posted documents cannot be deleted, and an account with entries cannot be deleted.

## Data & Technical

### 15. Where is my data stored?

- **Desktop (Electron) + PostgreSQL**: your data lives on a PostgreSQL server — a single source shared by the company's devices (the recommended mode for real work).
- **Browser mode**: a local PGlite database on your machine — suitable for trying out and evaluation, not a substitute for a shared server.

### 16. Does the "Maghz" AI Assistant execute operations without my permission?

No, never. Every write operation (create/edit/delete/post) stops at an **amber confirmation card** showing a clear Arabic summary, and it executes only when you click "Approve (موافقة)". The tools themselves are also filtered by your permissions, and every successful write is recorded in the Audit Log. Any claim by the assistant of an execution that did not actually happen is automatically discarded under the hallucination guard's penalty.

### 17. Can I work without internet?

Working on a local/internal-network PostgreSQL database works without internet, but the **AI assistant** needs a connection to its provider (Gemini or another) — except for the local Ollama provider. Export, printing, and all daily accounting work do not depend on an external internet connection.

### 18. Where do I find the Demo Data and what is the risk of it?

Demo Data is loaded optionally for trying out the system and training: sample customers, products, and invoices. Do not mix it with production — use it in a demo company only, and see the quick start file for how to initialize it.

### 19. A report shows numbers I do not expect — where do I start?

Start with three questions: (1) Is the date filter correct? (2) Do the filters exclude cancelled and paid cases as you expect? (3) Does your role enforce "own documents only"? Then check the troubleshooting file — most "invoice not visible" cases are caused by the own filter.

### 20. Are reports updated in real time?

Yes — every report queries the database directly when opened or when its filters change; there are no stale cached copies. The dashboard recalculates on every filter change, and any new posting appears the first time you reopen the report.

## A Final Tip

Didn't find your question here? Ask the "Maghz" AI Assistant (مغزى) directly (`Ctrl + Shift + K`) — it understands Arabic questions and can explain any screen or navigate you to it.

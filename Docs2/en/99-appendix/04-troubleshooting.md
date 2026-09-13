# Troubleshooting

> A reference table for the most common problems: the message or behavior as you see it, the likely cause, and the practical step-by-step fix.

## Login & Session

| Problem | Likely Cause | Solution |
|---|---|---|
| «اسم المستخدم أو كلمة المرور غير صحيحة» ("Incorrect username or password") | A typo, an Arabic keyboard layout or Caps Lock active, or the user is suspended | Check the language and Caps Lock; have the system admin log in and confirm the user is active; if the password is forgotten, the admin should reset it from Settings ← Users |
| **Automatic logout after 30 minutes** | An inactive session — the system logs the user out automatically after 30 minutes of inactivity (a security policy protecting the books) | Log in again; activity (clicking/typing/scrolling) renews the session automatically every time — anyone who leaves the device open will not stay logged in |
| The session logs me out immediately on another browser | Device-bound session protection — every tab/device has its own session fingerprint | Use the same browser/device, or log in separately on each device |

## Accounting & Journal Entries

| Problem | Likely Cause | Solution |
|---|---|---|
| **Saving an unbalanced journal entry fails** | Total debits do not equal total credits — the system forcibly rejects any unbalanced entry | Review the entry lines: adjust the amounts until both sides are equal, or delete an extra line. Hint: the difference between the two totals is displayed at the top of the screen |
| "Account is locked" or delete blocked after entries exist | The account has journal entries — an account with movements cannot be deleted (the Restrict rule) | Do not delete the account; deactivate it instead, or use a different account in future entries |
| **Receipt Voucher fails due to a missing sequence** | The voucher numbering sequence is not set up or its range has been exhausted | From Settings ← Document Sequences, check that a receipt voucher sequence exists, that it is active, and that its numbers have not run out |
| Account balances look wrong after editing an entry | The entry was a draft edited after early reports were already produced, or the posted entry was not reversed | A posted entry cannot be edited — create a **reversing entry** to cancel it, then a new correct entry |
| Document numbers skip values | A document failed to save after its number was generated (unbalanced entry, duplicate number...) — the sequence never rolls back | Normal, and it does not indicate data loss; check the cause of the failed save in the message shown at the time |

## Sales & POS

| Problem | Likely Cause | Solution |
|---|---|---|
| **The cash invoice showed as paid automatically** | Normal and intended: a cash invoice (immediate payment) is recorded as fully paid at the moment of posting because the payment is tied to it | Do not create a Receipt Voucher for it; just confirm the cash account selected in the payment |
| **Inventory drops after posting an invoice** | Posting issues the quantity from the warehouse selected on the invoice — by default the one with the most stock if you did not choose | Review the item's stock movements; going forward, explicitly select the required warehouse in the invoice header before posting |
| **The invoice I want is not visible in the list** | The "own documents only" filter (own) — your role sees only your own invoices, and this invoice was created by a colleague | Ask your manager to view it, or change your role to include full `module.view` instead of `own` |
| **A POS cart is lost** | The cart is held (Hold with F10) in a held state — it is not lost, but it is not in the active cart | Open the held carts list on the cashier screen and restore it; held carts are stored locally on the device |
| **Cannot post: «المخزون لا يكفي لصرف الخامات» ("Insufficient stock to issue materials")** (Manufacturing) | The material quantities in the BOM exceed the available balance in the warehouse | Purchase or transfer the materials to the relevant warehouse first, or adjust the BOM/batch quantities to match what is available |
| POS sales do not appear in the sales invoices list | POS receipts have independent `POS-` numbering and live in the same invoice record with a distinguishing column | Search directly by the `POS-...` number, or remove the status/customer filter |

## Permissions

| Problem | Likely Cause | Solution |
|---|---|---|
| **I do not see an entire module menu** (such as Settings or HR) | Your role holds no view/create permission there — the sidebar hides unauthorized modules | Ask the admin to grant the permission from Settings ← Roles (see the permissions matrix file to know what your role holds) |
| "Create" or "Export" buttons never appear | The buttons are hidden with the permission, not merely disabled | Same fix: grant the required permission (`module.create` or `reports.export`) |
| The Custom Report Builder is missing from the Reports Hub | It requires the special `reports.custom` permission | Request it from the admin — it is granted separately from `reports.view` |
| The Roles page is read-only | Your role is not `admin`/`super_admin`, or the displayed role is a protected system role | A system role cannot be edited — use the "Clone (نسخ)" button to create an editable custom role |

## The "Maghz" AI Assistant

| Problem | Likely Cause | Solution |
|---|---|---|
| **An amber confirmation card is waiting for approval** | The assistant requested a write operation and the system pauses awaiting your decision — this is correct behavior | Read the operation summary and click "Approve (موافقة)" to execute or "Reject (رفض)" to cancel; the card does not disappear without your decision |
| A tool card shows "Error" after approval | A temporary connection drop or the call limit was exceeded | Retry after a few moments; if it repeats, check the provider settings at `/settings/ai` |
| A batch of operations stopped midway | A manual pause, failures among items that depend on each other, or the app was closed during execution | Use the resume/retry-failed buttons on the progress card — the batch state is stored in the database and survives a restart |
| The assistant cannot "see" a specific module | The module's tools are filtered by your permissions | Ask for the appropriate permission to be granted to your role, then start the conversation again |
| The assistant apologizes for not performing an operation | The call limit was exceeded or the provider connection dropped | Wait a moment and retry, and check the connection and the `/settings/ai` settings |

## Infrastructure & Data

| Problem | Likely Cause | Solution |
|---|---|---|
| **External database connection problems** | The PostgreSQL service is not running, or the connection settings (host/port/key) are wrong | Confirm the PostgreSQL service is running on the server, review the connection settings on the database setup screen, then restart the app |
| The app runs with no data after changing devices | Desktop mode reads from the server's database — you must connect to the same database | Check the database connection setting and match it to the original server |
| **The zero-difference adjustment will not post** | A stock adjustment with a zero difference (the count matched the system exactly) has no accounting effect — no journal entry is created for it | Normal, and it needs no action; only adjustments with a real difference post and affect the accounts |
| PDF export does not open a file | The browser blocked the popup, or you expected a file to download automatically | Allow popups for the site and export again — the first click downloads the export libraries, so it is a little slower |
| A PDF with a font imperfect for Arabic | The default generation library has limited fonts | Try HTML or Excel export for complex Arabic documents, and follow the system updates for font improvements |
| Demo data appeared in the production database | You ran the Demo Data initialization by mistake | Do not use Demo Data in real work; create a clean company or ask the admin to clean the demo records |

## Miscellaneous Sales & Documents

| Problem | Likely Cause | Solution |
|---|---|---|
| A quotation (`QOT-`) does not convert to an invoice | Conversion is a separate action on the quotations page, and it may be blocked by a missing `sales.create` permission | Open the quotation and click the convert-to-invoice button; if the button is missing, check your permissions |
| A sales report total does not match the sum of my invoices | The reports exclude cancelled (`cancelled`) invoices from all calculations | Normal — check the statuses of the invoices you tallied manually |
| My role's permissions changed but the effect did not appear immediately | Session permissions are read at login | Log out and back in for the new permissions to apply |
| Pagination on a large list is slow or jumps | The page size is too large or filters are not set | Reduce the page size from the size switcher below the table, and set the status/customer filters to narrow the results |

## General Diagnosis Tips

- Always start by asking: "Is this a permissions problem?" — many "missing" things (menus, buttons, reports) are caused by RBAC, not a fault.
- After any failed save, do not retry rapidly: read the message, it describes the real cause (insufficient stock, duplicate number, unbalanced entry...).
- The Audit Log is your memory: any "who deleted? who edited? when?" has its answer there with the user name and timestamp — it requires the `settings.audit_log` permission.
- If a database problem persists, collect: the time of the problem, the message shown, and the last operation that succeeded — then contact the system administrator.
- Document-posting problems are usually resolved with three checks: does the warehouse have stock? will the journal entry be balanced? is the numbering sequence active?

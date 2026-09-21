# Glossary

> A quick reference for every accounting and operational term used by the system — plain-English explanations, with the Arabic label shown in the app UI kept verbatim.

## Core Accounting Terms

| Term | Arabic Label in the App UI | Plain-English Explanation |
|---|---|---|
| **Journal Entry** | القيد (قيد اليومية) | An accounting record documenting a financial transaction: every entry has two equal sides — debit and credit. Example: a credit sale = debit (the customer's Accounts Receivable) and credit (sales revenue) |
| **Debit** | المدين | The side representing "what you own or what is owed to you" — an increase in assets or expenses |
| **Credit** | الدائن | The side representing "what you owe or the source of the money" — an increase in liabilities or revenue |
| **The Golden Rule** | القاعدة الذهبية | Total debits must equal total credits in every journal entry; if they do not, the entry is rejected and will not be saved |
| **Draft** | مسودة | A document that is saved but has not yet affected the accounts; it can be edited and deleted |
| **Post / Posting** | الترحيل | Final approval of a document: it creates its journal entry, affects inventory and accounts, and locks the document against editing |
| **Chart of Accounts** | شجرة الحسابات | An organized list of all the company's accounts (assets, liabilities, revenue, expenses) arranged as a parent-child tree |
| **Group Account** | الحساب الجماعي | A parent account that receives no direct entries; its balance = the sum of its children's balances (example: "Current Assets") |
| **Trial Balance** | ميزان المراجعة | A report showing each account's balance as debit and credit to confirm the books are balanced |
| **Income Statement (Profit & Loss)** | قائمة الدخل | A report showing revenue minus expenses = profit or loss for a specific period |
| **Balance Sheet (Statement of Financial Position)** | قائمة المركز المالي (الميزانية العمومية) | A report showing what the company owns and what it owes at a specific moment |
| **Cash Flow Statement** | قائمة التدفقات النقدية | A report showing where cash came from and where it went during the period |
| **Account Ledger** | دفتر الحساب | A statement of all entries recorded on a single account, in chronological order, with the running balance |
| **Reversing Entry** | القيد العكسي | A new entry in the opposite direction that cancels the effect of a wrongly posted entry — the only way to correct something already posted |

## Receivables & Collection

| Term | Arabic Label in the App UI | Plain-English Explanation |
|---|---|---|
| **Accounts Receivable (AR)** | ذمم مدينة | Money owed **to you** by customers (you sold on credit and it has not been collected yet) |
| **Accounts Payable (AP)** | ذمم دائنة | Money you owe **to suppliers** (you bought on credit and have not paid yet) |
| **Aging** | أعمار الذمم | Splitting outstanding amounts by age: 0–30 / 31–60 / 61–90 / 90+ days from the due date — the older the age, the higher the risk of non-collection |
| **Receipt Voucher** | سند قبض | A document recording money received from a customer (settling a debt or an advance payment) |
| **Payment Voucher** | سند صرف | A document recording money paid to a supplier or for an expense |
| **Credit Sale** | الفاتورة الآجلة | An invoice where goods are delivered now and payment comes later on a due date — it raises the customer's Accounts Receivable |

## Inventory & Costing

| Term | Arabic Label in the App UI | Plain-English Explanation |
|---|---|---|
| **Base Unit** | الوحدة الأساسية | The smallest unit of measure in which an item is always stored in the warehouses |
| **Conversion Factor** | معامل التحويل | The number of base units in a larger unit — example: 1 carton = 12 base units |
| **Min Stock Alert** | حد التنبيه الأدنى | The quantity at which, once the balance in a given warehouse reaches it, the item appears in the low-stock reports |
| **Moving Weighted Average** | المتوسط المرجحي | The item costing method: the average cost of the available quantities (old and new together) after every receipt — applied when a work order completes |
| **Work In Progress (WIP)** | حساب المخزون قيد التشغيل | An account that temporarily holds the cost of materials issued to a work order that is not yet complete |
| **BOM (Bill of Materials)** | قائمة المواد | A product's manufacturing "recipe": which materials are consumed and in what quantities, and what the final output is |
| **Work Order** | أمر التشغيل | An order to execute a BOM in a specific quantity: it issues the materials, passes through stages, then receives the output |
| **Batch** | الدفعة | The number of times a BOM is executed in a work order — output = batches × the BOM's output quantity |
| **Stock Adjustment** | تسوية المخزون | Correcting the difference between the quantity recorded in the system and the actual physical count (with documented reasons) |
| **Stock Transfer** | تحويل المخزون | Moving a quantity from one warehouse to another — it does not change total stock, only its location (numbered `TRF-`) |
| **Stock Count** | الجرد | Counting the actual quantities in the warehouse and comparing them to the system; the difference is handled with an adjustment |
| **Out of Stock** | الصنف النافد | The item's balance has reached zero in the warehouse |
| **Low Stock** | الصنف منخفض | The item's balance is at or below the min stock alert but has not run out |

## Point of Sale (POS)

| Term | Arabic Label in the App UI | Plain-English Explanation |
|---|---|---|
| **Shift** | الورديـة | The cashier's working session at the cash box: opened at the start of work (with an opening balance) and closed at the end of it |
| **Z Report** | تقرير Z | The shift-closing report: cash and credit sales, payments, and the cash difference |
| **Cash Box** | صندوق النقد | The actual cash drawer at the cashier, linked to a cash account in the Chart of Accounts |
| **Walk-in Customer** | العميل النقدي الافتراضي | A default customer used for pure cash sales without recording any buyer details |
| **POS Receipt** | إيصال نقاط البيع | The quick-sale receipt, numbered independently starting with `POS-` (while sales invoices start with `INV-`) |
| **Zero Difference** | الفرق الصفري | A shift-closing state where the physically counted cash exactly matches the balance expected in the system |
| **Held Cart** | السلة المعلقة | A POS cart temporarily parked (with the F10 key) to serve another customer, then restored later |
| **Mixed Payment** | الدفع المختلط | Paying an invoice with a mix of cash and credit (part paid now, the rest on account) |

## Currencies & Accounts

| Term | Arabic Label in the App UI | Plain-English Explanation |
|---|---|---|
| **Base Currency** | العملة الأساسية | The company's main bookkeeping currency — the Yemeni Rial (YER) by default; all main reports are displayed in it |
| **Base Currency Amount** | المعادل بالعملة الأساسية | The value of a foreign transaction after conversion to the base currency at the exchange rate — always computed server-side to guarantee a stable balance |
| **Exchange Rate** | سعر الصرف | How much of the base currency equals one unit of another currency (1 USD = 1500 YER) |
| **Opening Balance** | الرصيد الافتتاحي | The account balance when you start using the system (or at the start of the year) — enter it before recording regular transactions so the balances are correct |
| **VAT** | ضريبة القيمة المضافة | A percentage tax added to the selling price (the rate is set in Settings) and computed after the discount, on the net amount |

## Governance & System

| Term | Arabic Label in the App UI | Plain-English Explanation |
|---|---|---|
| **Audit Log** | سجل التدقيق | A non-deletable log recording every sensitive operation: who did it, when, and the old and new values |
| **Permissions (RBAC)** | الصلاحيات (RBAC) | The system that defines what each role can do: view/create/edit/delete/post for every module |
| **Own (my documents only)** | صلاحية «مستنداتي فقط» | A permission level restricting the user to seeing and editing **their own documents only** (example: a rep sees their own invoices, not their colleagues') |
| **Multi-tenancy** | عزل المنشآت | All data is tied to a company ID — a user of company A never sees company B's data |
| **Document Sequencing** | الترقيم التلقائي | Automatic generation of unified document numbers: `INV-` sales invoices, `PINV-` purchases, `POS-` POS receipts, `SR-`/`PR-` returns, `ADJ-` adjustments, `TRF-` transfers, `WO-` work orders, `QOT-` quotations, `PO-` purchase orders, `CUS-` customers, `PRD-` products |
| **Demo Data** | البيانات التجريبية | Ready-made sample data for trying out the system and training (customers, products, invoices...) |
| **Default Data** | البيانات الافتراضية | What the system creates automatically for any company: a standards-compliant Chart of Accounts, tax settings, numbering sequences |
| **"Maghz" AI Assistant** | الوكيل الذكي «مغزى» | The system's built-in smart assistant — it performs operations in Arabic after you approve a confirmation card for every write |
| **Confirmation Card** | بطاقة التأكيد الكهرمانية | An orange card that appears before any write from the assistant, showing the operation summary with Approve/Reject buttons |
| **Reports Hub** | مركز التقارير | A page gathering all the system's reports as cards — Sidebar ← Reports |
| **Pipeline Stages** | مراحل البيع (خط الأنابيب) | The stages of a sales opportunity from first contact to close (won/lost) — shown in the opportunities funnel on the dashboard |

## Purchases, CRM & HR Terms

| Term | Arabic Label in the App UI | Plain-English Explanation |
|---|---|---|
| **Quotation** | عرض السعر | A temporary pricing document numbered `QOT-` — it does not affect inventory or accounts, and can be converted to a sales invoice when the customer accepts |
| **Purchase Order** | أمر الشراء | A documented purchase request numbered `PO-` sent to the supplier before the goods arrive; a purchase invoice (`PINV-`) is then created for it |
| **Lead** | العميل المحتمل | A contact interested in your products who has not yet become an actual customer — the source of opportunities in CRM |
| **Opportunity** | الفرصة | A potential deal with a stage and a monetary value that advances through the pipeline until it is won or lost |
| **Shift (HR)** | الورديـة (الموظفين) | A pattern for distributing employee working hours for attendance purposes — used in the attendance and payroll records |
| **Leave Request** | طلب الإجازة | A request submitted by an employee and approved by the manager — pending leaves appear on the dashboard |
| **Payroll Run** | مسير الرواتب | A monthly calculation cycle: Preview → Generate → Post, becoming payroll journal entries in accounting |
| **End of Service** | نهاية الخدمة | The employee's dues when their relationship with the company ends, calculated according to their length of service |

## Tips for Using the Glossary

- The Arabic label column shows the term exactly as it appears in the app interface — use it to match what you see on screen.
- If a screen's naming differs from the glossary, treat the glossary as the reference and report it to the developers.
- The detailed files for each module (guide folders 06 to 13) explain every term in the context of its screen.

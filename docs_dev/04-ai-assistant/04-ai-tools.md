# مرجع أدوات الوكيل الذكي

> 249 أداة مصنفة — الأدوات **مفلترة بصلاحياتك**: لا ترى إلا ما يسمح به دورك

---

## كيف تقرأ هذا المرجع؟

- `بحث` = يقرأ فقط (ينفذ فوراً بلا موافقة)
- `كتابة` = ينشئ/يعدل/يرحّل — **يتوقف على بطاقة موافقة**
- كل الأسماء منطقية: `<وحدة>.<فعل>_<كيان>`

---

## البحث — `search.*` (32 أداة، ضبابي عربي)

| الأداة | تبحث في |
|---|---|
| `search.customers` / `search.suppliers` | العملاء / الموردين (الاسم + الهاتف) |
| `search.products` | المنتجات (الاسم + SKU + **الباركود**) |
| `search.accounts` / `search.cash_boxes` / `search.cost_centers` | الحسابات / الخزائن / مراكز التكلفة |
| `search.leads` / `search.opportunities` / `search.tasks` / `search.activities` | كيانات CRM |
| `search.employees` / `search.departments` | الموظفون / الأقسام |
| `search.sales_invoices` / `search.purchase_invoices` / `search.purchase_orders` | الفواتير |
| `search.quotations` / `search.returns` | العروض / المردودات |
| `search.receipt_vouchers` / `search.payment_vouchers` | السندات |
| `search.journal_entries` / `search.stock_movements` | القيود / حركات المخزون |
| `search.boms` / `search.work_orders` | شجرة المواد / أوامر التشغيل |
| `search.warehouses` / `search.units` / `search.product_types` / `search.categories` | مراجع المخازن |
| `search.attendance` / `search.leaves` / `search.payroll_runs` / `search.end_of_services` | سجلات HR |
| `search.stock_adjustments` / `search.stock_transfers` / `search.document_sequences` | تسويات/تحويلات/تسلسلات |

---

## القراءة السريعة — `read` + `get` (أهم الأدوات)

| الأداة | تعطيك |
|---|---|
| `core.get_company_info` | سياق شركتك |
| `sales.get_sales_summary` | ملخص فترة (إيراد/عدد/متوسط) |
| `sales.get_ar_aging` / `purchases.get_ap_aging_total` | أعمار الذمم AR/AP |
| `sales.get_customer_statement` | كشف حساب عميل |
| `accounting.get_trial_balance` / `accounting.get_profit_loss` | الميزان / الأرباح |
| `inventory.get_low_stock` | النواقص فوراً |
| `read.balance_sheet` / `read.profit_loss` / `read.cash_flow` | القوائم المالية |
| `read.inventory_valuation` / `read.inventory_kpis` | تقييم المخزون |
| `read.ar_aging` / `read.ap_aging` | الأعمار التفصيلية |
| `hr.get_employee_details` / `hr.get_leave_balances` | تفاصيل موظف / أرصدة إجازات |
| `crm.get_leads` / `crm.get_opportunities` / `crm.get_tasks` / `crm.get_activities` | قوائم CRM بفلاتر |
| `app.list_pages` / `app.navigate` | كتالوج الصفحات ← الانتقال |

---

## التقارير المعيارية — `reportTools`

### محاسبة
`accounting.trial_balance` • `accounting.balance_sheet` • `accounting.profit_loss` • `accounting.account_ledger` • `accounting.journal_register` • `accounting.cash_flow`

### مبيعات
`sales.revenue_analysis` • `sales.customer_statement` • **`sales.vat_summary`** • `sales.invoice_register` • `sales.top_customers`

### مشتريات
`purchases.purchase_analysis` • `purchases.supplier_statement` • `purchases.purchase_register` • `purchases.top_suppliers`

### مخازن
`inventory.stock_valuation` • `inventory.stock_movement_report` • `inventory.low_stock_alert` • `inventory.product_ledger` • `inventory.inventory_analysis`

### تصنيع
`manufacturing.production_cost` • `manufacturing.variance_analysis`

### HR
`hr.payroll_report` • `hr.attendance_report` • `hr.leaves_report` • `hr.employees_report`

### CRM
`crm.lead_conversion` • `crm.opportunity_pipeline` • `crm.sales_funnel` • **`crm.follow_ups`** • **`crm.rep_performance`**

---

## التقارير التفصيلية — `detailedReportTools`

`sales.invoices_detailed` / `quotations_detailed` / `returns_detailed` / **`sales_by_product`** / **`sales_by_user`** / `purchases.invoices_detailed` / `orders_detailed` / `returns_detailed` / **`purchases_by_product`** / **`purchases_by_user`** / `inventory.movements_detailed` / **`stock_status_detailed`** (نشط/راكد) / `stock_by_warehouse` / `movements_by_party` / `product_ledger_detailed` / **`sales.cash_vs_credit`** / **`purchases.cash_vs_credit`**

---

## أدوات الكتابة — أهمها لكل وحدة

### المبيعات (`sales.*`)
`create_customer` / `update_customer` • `create_invoice` / `update_invoice` / `delete_invoice` / **`post_invoice`** • `create_quotation` / `update_quotation` / `delete_quotation` • `create_sales_return` / `post_return`

### المشتريات (`purchases.*`)
`create_supplier` / `update_supplier` / `delete_supplier` • `create_invoice` / `post_invoice` • `create_purchase_order` / `update_order` • `create_purchase_return` / `post_return`

### المحاسبة (`accounting.*`)
**`create_expense_voucher`** ⭐ (مصروف عام بلا مورد) • `create_receipt_voucher` / `update` / **`post_receipt_voucher`** • `create_payment_voucher` / `post_payment_voucher` • `create_journal_entry` / `post` • `create_account` / `update_account`

### المخازن (`inventory.*`)
`create_product` / `update_product` • `create_warehouse` / `update_warehouse` • `create_stock_adjustment` / `post` • `create_stock_transfer` • `create_category`

### التصنيع (`manufacturing.*`)
`create_bom` / `update_bom` / `delete_bom` • `create_work_order` / `update_work_order` / `delete_work_order` • **`update_work_order_status`** (بدء/إكمال/إلغاء — يميز `outputWarehouseId` عند الإكمال) • **`check_bom_availability`** (قراءة)

### HR (`hr.*`)
`create_employee` / `update_employee` / `delete_employee` • `create_leave` / `update` / `delete` • **`preview_payroll`** (قراءة) / **`generate_payroll_run`** (كتابة — مشتق من بطاقات الموظفين) / `post_payroll_run` / **`delete_payroll_run`** (مسودة فقط) • **`preview_end_of_service`** (قراءة) / `create_end_of_service` / `update_end_of_service_status` / **`pay_end_of_service`** (بخزنة) • **`save_attendance`** (يشتق التأخير/OT خدمياً) • `get_leave_balances` / `get_employee_details` • `create_department` / `update` / `delete_department`

### CRM (`crm.*`)
`create_lead` / `update_lead` / `update_lead_status` • `create_opportunity` / `update_opportunity` / **`update_opportunity_stage`** / **`win_opportunity`** (يقفلها ويسأل عن الفاتورة — لا ينشئها تلقائياً) • `create_task` / `update_task` / **`complete_task`** / `delete_task` • `create_activity` / `update_activity` / `delete_activity` • **`convert_lead_to_customer`**

### الإعدادات (`settings.*`)
`update_company` / `update_branch` • `create/update/delete_product_type` / `_unit` / `_cash_box` / `_cost_center` • `create/update/deactivate_payroll_component` • `get/update_document_sequences` • `update_default_account` / **`apply_default_template`** • `get_payroll_components`

---

## المعالجات المركبة — `wizardTools` (ذرّية متعددة الخطوات)

| الأداة | التسلسل | التراجع |
|---|---|---|
| **`sales.create_and_post_invoice`** | إنشاء + ترحيل | — |
| **`purchases.create_and_post_invoice`** | إنشاء + ترحيل | — |
| **`crm.convert_lead_to_customer`** | كود موحد + عميل + فرصة اختيارية + تحديث حالة | idempotent |
| **`crm.qualify_lead`** | تأهيل + فرصة + مهمة متابعة (3 أيام) | rollback تعويضي خطوة بخطوة |
| **`inventory.transfer_stock`** | تحويل بين مستودعين | — |
| **`hr.process_payroll_flow`** | معاينة ← إنشاء ← ترحيل | **حذف المسيرة عند فشل الترحيل** |
| **`accounting.create_journal_flow`** | قيد متوازن + ترحيل | — |

---

## حدود الاستخدام (Rate Limiting)

| النوع | الحد لكل مستخدم |
|---|---|
| أدوات القراءة | 300/دقيقة |
| أدوات الكتابة | 60/دقيقة |
| كاش القراءة | 60 ثانية (يُلغى بعد أي كتابة) |

---

## ملاحظات

- أي أداة اسمها غير مسجل (هلوسة نموذج) = **تُعامل ككتابة** ← بطاقة موافقة، والموافقة ترجع «أداة غير معروفة» (fail-closed)
- تطبيع المدخلات يعمل على **كل** الأدوات تلقائياً: أرقام هندية/فواصل/عملات/تواريخ حرة
- كل قائمة الأدوات هنا خاضعة لصلاحياتك — راجع [مصفوفة الصلاحيات](../06-appendix/02-permissions-matrix.md)

---

- العودة إلى **[نظرة عامة على الوكيل](01-ai-overview.md)** | **[الفهرس الرئيسي](../README.md)**

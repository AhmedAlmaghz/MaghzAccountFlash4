# نظام ترقيم المستندات

> ترقيم ذرّي آمن للتزامن — قابل للتخصيص الكامل لكل نوع مستند

---

## المبدأ

كل مستند يحصل على رقم بشري فريد من جدول `document_sequences` — بزيادة **ذرّية** تتحمل تزامن المستخدمين (نفس الوقت، نفس المستخدمين = أرقام مختلفة دائماً).

---

## خط الترقيم الذرّي

```sql
UPDATE document_sequences
SET current_number = current_number + increment_step
WHERE company_id = $1 AND document_type = $2
RETURNING current_number
```
1. **UPDATE ... RETURNING** — الزيادة والقراءة في عملية واحدة (لا يمكن لمستخدمين الحصول على نفس الرقم)
2. **فحص تفرد إضافي**: يتحقق أن الرقم الجديد غير مستخدم فعلاً في الجدول الهدف
3. **إعادة محاولة حتى 10x** — تتعامل مع تسلسلات متأخرة (مثل إدخال يدوي سابق)
4. التشكيل: `prefix-NNNN` مع **حشو** (paddingLength)

---

## التسلسلات القياسية (من البيانات الافتراضية)

| النوع | البادئة | الحشو | مثال | جدول الفحص |
|---|---|---|---|---|
| فاتورة مبيعات | `INV-` | 6 | INV-000123 | sales_invoices.invoice_number |
| مردود مبيعات | `SRT-` | 4 | SRT-0007 | sales_returns.return_number |
| عرض سعر | `QOT-` | 4 | QOT-0012 | quotations.quotation_number |
| أمر شراء | `PO-` | 6 | PO-000045 | purchase_orders.order_number |
| فاتورة مشتريات | `PINV-` | 4 | PINV-0031 | purchase_invoices.invoice_number |
| مردود مشتريات | `PRT-` | 4 | PRT-0009 | purchase_returns.return_number |
| قيد يومية | `JV-` | 7 | JV-0000004 | transactions.reference |
| سند قبض | `RV-` | 6 | RV-000012 | receipt_vouchers.voucher_number |
| سند صرف | `PV-` | 6 | PV-000058 | payment_vouchers.voucher_number |
| أمر تشغيل | `WO-` | 4 | WO-0023 | work_orders.order_number |
| قائمة مواد | `BOM-` | 4 | BOM-0005 | — |
| مسير رواتب | `PAY-` | 6 | PAY-000009 | payroll_runs.run_number |
| موظف | `EMP-` | 4 | EMP-0042 | employees.employee_number |
| منتج | `PRD-` | 7 | PRD-0000157 | products.code |
| تسوية مخزون | `ADJ-` | 6 | ADJ-000003 | stock_adjustments.adjustment_number |
| تحويل مخزون | `TRF-` | 6 | TRF-000011 | warehouse_transfers.transfer_number |
| عميل | `CUS-` | 5 | CUS-00042 | customers.code |
| مورد | `SUP-` | 4 | SUP-0018 | suppliers.code |
| مستودع | `WH-` | 3 | WH-004 | — |

---

## التخصيص (الإعدادات ← التسلسلات الرقمية)

لكل تسلسل يمكن تعديل:

| الحقل | الوصف |
|---|---|
| **البادئة** | `INV-` → `FCT-` مثلاً |
| **الرقم التالي** | قفز لقيمة معينة (بعد مستندات مستوردة) |
| **خطوة الزيادة** | 1 افتراضياً |
| **طول الحشو** | 4 → 6 خانات صفرية |
| **إعادة الضبط السنوي** (`yearReset`) | يبدأ من جديد كل سنة (INV-2026-0001 إن عدلت البادئة) |
| نشط/موقوف | تعطيل تسلسل يوقف توليد نوعه |

---

## خريطة الجداول والأعمدة (داخلية)

```ts
getTableForDocumentType(type):       'sales_invoice' → 'sales_invoices'
getNumberColumnForDocumentType(type): 'sales_invoice' → 'invoice_number'
```
الخريطتان **يجب أن تبقيا متطابقتين** — أي نوع جديد يضاف للاثنتين معاً (+ للـ seed).

---

## API المتاحة

| الدالة | الاستخدام |
|---|---|
| **`getNextDocumentNumber(companyId, type)`** | يستهلك رقماً (يستخدمه الإنشاء الداخلي دائماً — لا تستدعه من الشاشات) |
| **`peekNextDocumentNumber(companyId, type)`** | **معاينة بلا استهلاك** — لعرض «الرقم القادم:» في شاشة إنشاء |
| `getDocumentSequences` / `updateDocumentSequence` | إدارة الإعدادات |

---

## حالات عملية

| الموقف | الحل |
|---|---|
| استوردت بيانات من نظام قديم بأرقام مختلفة | عدّل «الرقم التالي» لما بعد أكبر رقم مستورد |
| أريد السنة في الرقم | فعّل `yearReset` + بادئة `INV-2026-` |
| الوكيل أنشأ فاتورة | نفس التسلسل بالضبط — `convertLeadToCustomer` وأدوات الإنشاء كلها تستدعي الـ API الموحد (لا توليد يدوي) |
| مستندين بنفس اللحظة | مستحيل — RETURNING ذرّية تضمن التمايز |

---

## ملاحظة تقنية

- تسلسل **بلا قيد فحص** (BOM/warehouse): النوع لا يملك عمود رقم قابل للاصطدام — فحص التفرد يُتخطى
- التسلسلات **لكل شركة** — شركتان لكل منهما INV-000001 خاصة بها

---

## روابط ذات صلة
- **[الإعدادات ← التسلسلات →](../02-user-guide/10-settings.md)**
- **[مرجع API →](04-api-reference.md)**

---

- العودة إلى **[الفهرس الرئيسي](../README.md)**

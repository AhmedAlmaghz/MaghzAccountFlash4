# مرجع واجهات API

> دليل الواجهات البرمجية لكل وحدة — `src/modules/*/api.ts` + `src/core/api.ts`

---

## نمط الاستدعاء الموحد

```ts
// كل method ترجع شكلاً موحداً:
{ success: boolean; data?: T; error?: string }

// الترقيم من الخادم:
{ items: T[]; total: number; page: number; pageSize: number; totalPages: number }
```

كل method تمر بـ: **validation (Zod) → حراس العمل → SQL parameterized (ب casts) → audit**.

---

## salesApi — `src/modules/sales/api.ts`

### العملاء
| Method | الوصف |
|---|---|
| `getCustomers` / `getCustomersPaginated({search?, isActive?})` | قائمة / مرقمة |
| `getCustomerById` | واحد |
| `createCustomer` / `updateCustomer` / `deleteCustomer` | CRUD (الحذف محروس بFK) |
| `getCustomerStatement` | كشف موحد: **افتتاحي** + فواتير + سندات مرحّلة |
| `getCustomerArAging` | شرائح 0-30/31-60/61-90/+90 (حسب due_date، تشمل الافتتاحي) |

### الفواتير
| Method | الوصف |
|---|---|
| `getInvoices` / `getInvoicesPaginated({status?, customerId?, createdBy?})` / `getInvoiceById` | قراءة |
| `getOutstandingInvoicesForCustomer` | المستحقة للتخصيص بالسندات |
| `getPostedInvoicesWithLines` | المرحّلة بأسطرها (لمردودات البيع) |
| `createInvoice` | CTE ذرّية رأس+أسطر، auto-compute `baseCurrencyAmount`، رفض overpayment، attachments |
| `updateInvoice` | يمنع تعديل أسطر المرحّلة + تقليل paid_amount |
| `deleteInvoice` | مسودة بلا مدفوعات فقط |
| `postInvoice` | قيد (نقدي=خزينة+paid / آجل=عميل) + حركة out + رصيد العميل |

### العروض والمردودات
`getQuotations/Paginated` • `createQuotation` • `convertQuotationToInvoice` (يحمي converted) • `getReturns/Paginated` • `createReturn` (من فاتورة مرحّلة) • `postReturn` (حركة in + رصيد ينقص + قيد)

---

## purchasesApi — `src/modules/purchases/api.ts`

نفس أنماط المبيعات معكوسة:
- الموردون: `getSuppliers/Paginated` • `getSupplierStatement` (استعلام واحد موحد) • `getApAging` (لمورد) / **`getApAgingTotal`** (شركة كاملة — يمنع N+1)
- الفواتير: `createInvoice/postInvoice` (نقدي=خزينة/آجل=مورد) + `getOutstandingInvoicesForSupplier`
- الأوامر: `getOrders/Paginated` • `createOrder` • `convertOrderToInvoice` (+receivedQuantity)
- المردودات: `postReturn` (حركة out)

---

## inventoryApi — `src/modules/inventory/api.ts`

| المجموعة | Methods |
|---|---|
| المنتجات | `getProducts` / `getProductsPaginated({search?, isActive?, productTypeId?})` / `createProduct` / `updateProduct` / `deleteProduct` |
| المستودعات | `getWarehouses` / `createWarehouse` / `updateWarehouse` / `deleteWarehouse` |
| الأرصدة | `getStock` / `getProductStock` / `getStockDetailed` |
| الحركات | `getInventoryTransactions/Paginated` (قراءة فقط) |
| التحويلات | `createStockTransfer` / `completeStockTransfer` / `deleteStockTransfer` |
| التسويات | `createStockAdjustment` / `approveStockAdjustment` / `postStockAdjustment` (حركة+رصيد+قيد) |
| التصنيفات | `getCategories` / `createProductCategory` / ... |
| KPIs | `getInventoryKpis` |

---

## manufacturingApi — `src/modules/manufacturing/api.ts`

| Method | الوصف |
|---|---|
| `getBoms` / `getBomById` (بالأسطر json_agg) / `createBom` / `updateBom` / `deleteBom` | إدارة BOM |
| `getWorkOrders` / `getWorkOrderById` (+bomOutputQuantity) / `createWorkOrder` | **يشتق الأسطر من BOM + يحسب التكلفة آلياً** (materials + productionCosts) |
| `updateWorkOrder` | إعادة حساب التكلفة عند تغيّر الأسطر/التكاليف (completed يحتفظ بالمرحّل) |
| **`getBomAvailability(companyId, bomId, qty)`** | لكل مادة: مطلوب/متاح/يكفي + **maxProducible** (عبر كل المستودعات SUM) |
| **`startWorkOrder`** | بوابة توفر ← حركات out ذرّية ← قيد WIP — فشل = تقرير نقص |
| **`completeWorkOrder`** | استلام التام بoutputWarehouseId + تسوية الفرق (actual=planned افتراضياً، **تثبيت الفعلي في DB**) + قيد تام |
| `cancelWorkOrder({returnMaterials?})` | إلغاء (+ إرجاع اختياري) |
| `updateWorkOrderStatus` | **مندوب موحد** لآلة الحالات (خطوة إلى start/complete) |
| `batchUpdateConsumptions` | UPDATE ... FROM (VALUES) واحدة |

---

## hrApi — `src/modules/hr/api.ts`

| المجموعة | الحراس البارزة |
|---|---|
| الموظفون: `getEmployees/Paginated` (بحث بemployee_number) `createEmployee` `updateEmployee` (updated_at دائماً) `deleteEmployee` (**مرفوض بوجود مسيرات/إجازات/حضور/EOS**) | |
| الحضور: `getAttendance(month, year)` / **`saveAttendance`** | **تطبيع الخُرم خدمياً** (HH:mm → timestamp) + اشتقاق isLate/OT + **upsert حقيقي** (مفتاح Date object مطبّع!) |
| الإجازات: `createLeave` (أيام خدمية + رفض تداخل) / `updateLeaveStatus` (**آلة حالات + رصيد صارم**) / `getLeaveBalances` / `deleteLeave` (pending/rejected فقط) | |
| الرواتب: `previewPayrollRun` / `createPayrollRun` (**يعيد حساب كل سطر خدمياً** + unique فترة) / **`postPayrollRun`** (قيد gross-up **ذري مع الحالة**) / `deletePayrollRun` (draft فقط) | |
| نهاية الخدمة: `previewEndOfService` / `createEndOfService` (خادمي الحساب) / `updateEndOfServiceStatus` (draft→approved = قيد استحقاق) / **`payEndOfService`** (قيد تسوية بخزنة) | |
| الأقسام: `getDepartments` (مدير + عدد موظفين) / `deleteDepartment` (مرفوض بوجود موظفين) | |
| `getHrKpis` | COUNT FILTER خدمي |

**المحرك الموحد**: `src/modules/hr/payrollEngine.ts` — computeLeaveDays/Balance, computePayrollLine, computeEos, deriveAttendance, buildPolicy (pure — تستخدمه UI + API + AI معاً).

---

## crmApi — `src/modules/crm/api.ts`

| الكيان | الحراس |
|---|---|
| Leads | `createLead` (حارس تكرار اسم/هاتف بnormalize) • **`convertLeadToCustomer`** (CTE ذرّية: كود من التسلسل + فرصة اختيارية + idempotent) • `deleteLead` (مرفوض بمراجع — رسالة تفصيلية) |
| Opportunities | `updateOpportunity` (**آلة أمامية صارمة** — won/lost تختم closeDate + probability) |
| Tasks / Activities | `createActivity` **يختم leads.lastContactedAt ذرّياً** • `deleteTask/Activity` |
| KPIs | `getLeadKpis/getOpportunityKpis/...` — COUNT FILTER في SQL |

---

## accountingApi — `src/modules/accounting/api.ts`

| المجموعة | Methods |
|---|---|
| الحسابات | `getAccounts` (**runningBalance من JEs** — العمود legacy مرآة فقط) / `createAccount` (safeUserId + ::uuid) / `deleteAccount` (RESTRICT) |
| القيود | `getTransactions/Paginated` / `createTransaction` / `postTransaction` / `deleteTransaction` |
| سندات القبض | `createReceiptVoucher` (تخصيص invoiceId+amountApplied بCHECK triple) / `updateReceiptVoucher` (يمنع تغيير ربط المرحّل) / `deleteReceiptVoucher` (ممنوع مع تخصيص) / `postVoucher('receipt')` |
| سندات الصرف | `createPaymentVoucher` (supplierId **أو** expenseAccountId إلزامي) / ... |
| **التخصيص** | **`applyPaymentToInvoice(...)`** — CTE واحدة: paid_amount + CASE status + رصيد الطرف |
| التقارير | `getTrialBalance` / `getBalanceSheet` / `getProfitLoss` / `getAccountLedger` (CTE prior للافتتاحي) |

---

## authApi + coreApi + settingsApi

### authApi (`auth/api.ts`)
`login` (rate-limited) • `logout` • Users CRUD + `resetPassword` • Roles CRUD • `getAuditLogs`

### coreApi (`modules/core/api.ts`) — session-scoped RPC
`getCompany` / `updateCompany` (لا يقبل id من الواجهة) • Currencies/VAT/Branches CRUD • `getSettings/setSetting`

### settingsApi (`src/core/api.ts`)
- **`getNextDocumentNumber(companyId, type)`** — atomic UPDATE...RETURNING + فحص تفرد + retry 10x
- `peekNextDocumentNumber` (معاينة بلا استهلاك)
- ProductTypes / Units / **CashBoxes** / CostCenters / PayrollComponents / DefaultAccounts CRUD + `applyDefaultTemplate`

---

## دوال النفع المشتركة (`src/core/utils/`)

| الأداة | الوظيفة |
|---|---|
| `toDateString(value)` | **إلزامية لكل تاريخ → SQL** (فخ String(Date)) |
| `duplicateDetection` / `documentDuplicate` | التطبيع العربي + Levenshtein + بصمات المستندات |
| `fuzzySearch(query, items, keyFn)` | بحث ضبابي (عبارة + tokens) لأدوات AI |
| `normalizeArabic(text)` | أ/إ/آ + ة/ه + ى/ي |
| `pagination` (`clampPageArgs`, `paginatedResult`) | الترقيم الموحد |
| `journalEntryGenerator` | قوالب القيود (مدين/دائن) لكل مستند |
| `openingBalance` | ترحيل الافتتاحيات (تحترم openingDate) |

---

## للتجربة السريعة (مطوري الواجهات)

كل API قابل للاستهلاك مباشرة من hooks الوحدات — أنماط جاهزة:
- `useXxxPaginated(companyId, filters?)` + mutations تُعيد `reload()` تلقائياً
- `useAsyncData(fetcher, deps, enabled)` للصفحات غير المرقمة
- لا تستدعِ API من مكوناتك مباشرة عند توفر hook

---

## روابط ذات صلة
- **[مرجع قاعدة البيانات →](03-database.md)**
- **[أدوات الوكيل (تستهلك نفس APIs) →](../04-ai-assistant/04-ai-tools.md)**

---

- العودة إلى **[الفهرس الرئيسي](../README.md)**

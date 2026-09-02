# مرجع قاعدة البيانات

> 58 جدولاً عبر 12 ملف schema — كلها مشدودة بـ company_id (multi-tenant)

---

## الجداول حسب الملف

### core.ts (6)
| الجدول | الأعمدة المفتاحية |
|---|---|
| `companies` | name, nameEn, **currency**, taxNumber, **dateFormat** (yyyy-MM-dd), **decimalPlaces** (2), **calendar** (gregorian/hijri), **fiscalYearStart** |
| `users` | username, email, fullName, passwordHash (PBKDF2), **role**, branchId, isActive, lastLoginAt |
| `roles` | name, **permissions** (JSON), isSystem |
| `settings` | **key**, value, category — UNIQUE(company_id, key) |
| `branches` | name, code, city, isActive |
| `currencies` | **code** (3), name, symbol, **exchangeRate** (= وحدات الأساسية لكل 1), isDefault, isActive |
| `vat_settings` | **vatRate** (15), vatNumber, isInclusive, accountId |

### accounting.ts (3)
| الجدول | الأعمدة المفتاحية |
|---|---|
| `accounts` | **code** (5 خانات), nameAr/nameEn, parentId, **type** (asset/liability/equity/revenue/expense), **nature** (debit/credit), isGroup, **openingAmount/openingDirection/openingBalancePosted/openingDate** |
| `transactions` | **date** (timestamptz), reference, **status** (draft/posted/cancelled) |
| `journal_entries` | *(تصميم مسطح — سطر لكل حساب مدين/دائن)*: transactionId, accountId, **debit**, **credit**, memo, companyId (denormalized) |

### sales.ts (6)
| الجدول | الأعمدة المفتاحية |
|---|---|
| `customers` | code, name, phone, **balance**, **openingBalance/openingDate**, creditLimit, isActive |
| `sales_invoices` | **invoiceNumber**, customerId, date, dueDate, subtotal, discountAmount, vatAmount, totalAmount, paidAmount, **currencyCode/exchangeRate/baseCurrencyAmount/baseCurrencyPaid**, **paymentType** (cash/credit), **cashBoxId**, **attachments** (jsonb), status |
| `sales_invoice_lines` | invoiceId, productId, quantity, unitPrice, discountPercent, vatPercent, lineTotal (+currency trio) |
| `quotations` + `quotation_lines` | quotationNumber, expiryDate, status (draft/accepted/rejected/converted) |
| `sales_returns` + `sales_return_lines` | returnNumber, invoiceId (nullable), reason, status |

### purchases.ts (7)
مطابقة للمبيعات: `suppliers` (بopening)، `purchase_invoices` (+**purchaseOrderId** الربط بالأمر)، `purchase_orders` (+**receivedQuantity** لكل سطر)، `purchase_returns` — كلها تحمل currency trio وpaymentType/cashBoxId.

### inventory.ts (9)
| الجدول | الأعمدة المفتاحية |
|---|---|
| `products` | **code, nameAr/nameEn, barcode, sku, unit** (نص!), **productTypeId**, **costPrice, salePrice**, categoryId, minStock, **openingStockQty/openingWarehouseId** |
| `product_product_categories` | m2m join — PK مركب (productId, categoryId) |
| `warehouses` | name, code, branchId |
| `stock` | productId, warehouseId, **quantity, minStockAlert** — لكل مستودع |
| `stock_movements` | **type** (in/out/transfer/adjustment), quantity, **reference** (رقم المستند البشري) |
| `warehouse_transfers` + lines | fromWarehouseId, toWarehouseId, status (pending/completed/cancelled) |
| `stock_adjustments` | systemQty, actualQty, **difference**, unitCost, reason, status, approvedBy/postedAt |

### manufacturing.ts (4)
| الجدول | الأعمدة المفتاحية |
|---|---|
| `boms` | productId (التام), **outputQuantity** (ناتج الدفعة), version, totalCost |
| `bom_lines` | bomId, **materialId** (الخام), quantity, unitCost |
| `work_orders` | orderNumber, productId, bomId, **quantity** (= عدد الدفعات), producedQuantity, **status** (planned/in_progress/completed/cancelled), planned/actual dates, **outputWarehouseId**, **productionCosts** (jsonb), **wipMaterialsCost** |
| `work_order_consumptions` | workOrderId, materialId, **plannedQuantity/actualQuantity**, unitCost, **actualUnitCost** |

### hr.ts (8)
| الجدول | الأعمدة المفتاحية |
|---|---|
| `departments` | name, managerId |
| `employees` | **employeeNumber**, fullName, departmentId, **hireDate**, **baseSalary**, opening trio, photoUrl, attachments (jsonb) |
| `attendance` | employeeId, **date**, checkIn (**nullable**), checkOut, overtimeHours, **status** (present/absent/late/on_leave) — **UNIQUE(employee_id, date)** |
| `leaves` | type (annual/sick/emergency/unpaid), startDate, endDate, **days** (service-computed), **status** machine, reason |
| `payroll_runs` | runNumber, **month, year**, totalAmount, status — **partial UNIQUE(month,year) WHERE draft/posted** |
| `payroll_lines` | employeeId, baseSalary, allowances, deductions, overtime, **netSalary**, overtimeHours |
| `end_of_service` | terminationDate, **serviceYears, eosAmount** (خادمية), reason, **status** (draft→approved→paid), **cashBoxId, paidAt** |

### crm.ts (4)
| الجدول | الأعمدة المفتاحية |
|---|---|
| `leads` | name, phone, source, **status** (new/contacted/qualified/converted/lost), **rating**, estimatedValue, assignedTo, **lastContactedAt** |
| `opportunities` | **value, stage** (آلة أمامية), **probability**, expectedCloseDate, **closeDate** (يختم عند won/lost) |
| `tasks` | title, dueDate, **priority**, status, assignedTo + روابط SET NULL الثلاثة |
| `activities` | type, subject, activityDate, durationMinutes, assignedTo — ختم lastContactedAt ذرّي |

### vouchers.ts (2)
| الجدول | الأعمدة المفتاحية |
|---|---|
| `receipt_vouchers` | voucherNumber, customerId, **invoiceId** (تخصيص!), amount, **amountApplied** (CHECK ≤ amount), currency trio, **paymentMethod** (cash/bank/check), **cashBoxId**, checkNumber/Date, status |
| `payment_vouchers` | **supplierId OR expenseAccountId** (واحد إلزامي), البقية مطابقة |

### settings.ts (7)
| الجدول | الاستخدام |
|---|---|
| `document_sequences` | documentType, prefix, currentNumber, paddingLength, yearReset — الترقيم atomic |
| `product_types` | أعلام الظهور + hasBOM + usage (finished/raw) + **حسابات دفترية للنوع** |
| `units` | nameAr/nameEn, conversionFactor, baseUnitId |
| `cash_boxes` | name, **accountId** (هدف القيود!), currentBalance |
| `cost_centers` | type, budgetAmount |
| `payroll_components` | type (earning/deduction), calculationMethod (fixed/percentage), defaultAccountId |
| `default_accounts` | **functionKey** (default_cash/default_wip/...) → accountId |

### audit.ts + ai.ts (3)
| الجدول | الاستخدام |
|---|---|
| `audit_logs` | سجل التدقيق (قيم قبل/بعد jsonb) |
| `ai_chat_sessions` / `ai_chat_messages` | جلسات الوكيل (فهارس أداء 0010) |

---

## الترحيلات (17 ملفاً — idempotent)

| # | الملف | الغرض |
|---|---|---|
| 0000 | init | **الخط الأساسي**: 63 جدولاً + FKs + فهارس |
| 0001 | invoice_payment_columns | cashBoxId لـ 6 جداول فواتير/أوامر |
| 0002 | drop_banks_unify_cash | **تقاعد موثق**: توحيد النقدية (خزائن فقط) |
| 0003 | wo_output_warehouse | مستودع استلام التام |
| 0004 | manufacturing_pro | outputQuantity للـ BOM |
| 0005 | wo_production_costs | تكاليف الإنتاج jsonb |
| 0006 | product_type_bom_flags | أعلام التصنيع للأنواع |
| 0007 | wo_wip_accounting | محاسبة WIP (IAS 2) |
| 0008/0009 | updated_at fixes | انجراف أعمدة audit |
| 0010 | ai_chat_performance | فهارس دردشة الوكيل |
| 0011 | crm_audit_columns | أعمدة تدقيق CRM |
| 0012 | default_accounts_expansion | حسابات 11303/52301/52401 + 11 مفتاح |
| 0013 | opening_balance_dates | opening_date لأربعة كيانات |
| 0014 | hr_professional | حسابات 215/21501-21503/52501 + قيود HR |
| 0015 | crm_professional | **تقاعد موثق**: جداول ميتة + 8 FKs + 6 فهارس |
| 0016 | hr_attendance_notes | checkIn nullable + payroll notes |

---

## الثوابت المحاسبية (الشجرة القياسية)

| الكود | الحساب |
|---|---|
| 11101 | الصندوق |
| 11201 | البنك |
| 11301 | المخزون |
| **11302** | إنتاج تحت التشغيل (WIP) |
| **11303** | بضاعة تامة الصنع |
| 21101 | الموردون |
| 21501/21502/21503 | رواتب/استقطاعات/نهاية خدمة مستحقة |
| 31101 | رأس المال |
| **31201** | الأرصدة الافتتاحية والتسويات |
| 41101 | المبيعات |
| 51101 | تكلفة المبيعات |
| 52101 | رواتب وأجور |
| 52201/52301/52401 | إيجار/نثريات/شحن |
| 52501 | مصروف نهاية الخدمة |
| 53101-53401 | عمالة/طاقة/تغليف/أخرى إنتاج |
| 53501 | خسائر إنتاج |

---

## قواعد ذهبية للتعديل

| القاعدة | التفصيل |
|---|---|
| **Drizzle ↔ SQL في توازن** | بعد أي schema تغيير: `drizzle-kit generate` ثم `npm run db:check` — أي انحراف يمنع الدمج |
| **PGlite قائمة يدوية** | أضف الملف الجديد لـ `pgliteAdapter.MIGRATIONS` أيضاً |
| **additive-only** | لا DROP إلا بتقاعد موثق باختبار "additive only" |
| **معاملات cast صريحة** | `::uuid` / `::timestamptz` / `::numeric` على كل معامل |
| **opening balance موثق** | كل كيان يرحّل افتتاحيه كقيد عبر 31201 |

---

## أوامر قاعدة البيانات

```bash
npm run db:reset:force    # إعادة بناء كاملة: migrations + seed (يحذف كل شيء!)
npm run db:check          # فحص انسجام Drizzle ↔ SQL
npm run e2e:reset         # مثل reset مع كلمة مرور اختبار محددة
npm run db:sync           # مزامنة قاعدة خارجية (متقدم — .env.local)
```

---

## روابط ذات صلة
- **[مرجع API →](04-api-reference.md)**
- **[البنية المعمارية →](01-architecture.md)**

---

- العودة إلى **[الفهرس الرئيسي](../README.md)**

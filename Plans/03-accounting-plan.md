# خطة تطوير وحدة Accounting (الحسابات)

## الوصف
قلب النظام المحاسبي: شجرة حسابات IFRS، قيود يومية، سندات قبض/صرف، تقارير مالية.

## الشاشات المطلوب تطويرها

### 1. ChartOfAccounts
- بحث فوري (Ctrl+K)
- تعديل (Modal مُحسّن)
- حذف (مع تحقق من وجود قيود — Restrict)
- تصدير (Excel/PDF)
- طباعة (شجرة حسابات)
- Drag & Drop لإعادة الترتيب (مستقبلي)

### 2. JournalEntriesPage
- شاشة إنشاء قيد احترافية: جدول Dr/Cr (AccountSelect + Amount + Memo)
- توازن تلقائي (Total Dr = Total Cr)
- حفظ مسودة → تعديل المسودة → ترحيل
- لا يمكن تعديل القيد المرحّل (فقط عكسي)
- طباعة القيد (قالب احترافي)
- عرض القيد (Detail View مع سطور)

### 3. ReceiptVouchersPage + PaymentVouchersPage
- CRUD كامل + تعديل المسودات
- ربط بفواتير (تسوية ديون)
- طباعة السند (قوالب جاهزة)

### 4. TrialBalancePage
- فلاتر تاريخ + تصدير
- Drill-down: الضغط على رصيد يفتح دفتر الأستاذ

### 5. BalanceSheetPage + ProfitLossPage
- مقارنة بالفترات السابقة
- رسوم بيانية (Treemap/Waterfall)
- تصدير PDF احترافي

### 6. AccountLedgerPage (جديدة)
- فلاتر (تاريخ، حركات/أرصدة فقط)
- تصدير/طباعة

## التحديثات على قاعدة البيانات
```ts
+ transactions.posted_by, transactions.posted_at
+ transactions.is_reversible (boolean)
+ transactions.reversed_transaction_id
+ journal_entries.line_number (for ordering)
+ accounts.depth, accounts.path (for tree display)
```

## المكونات الجديدة
- `JournalEntryForm.tsx`
- `VoucherForm.tsx`
- `AccountLedgerTable.tsx`
- `FinancialReportViewer.tsx`

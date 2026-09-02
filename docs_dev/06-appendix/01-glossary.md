# المسرد المحاسبي

> المصطلحات عربي ⇄ إنجليزي كما تُستخدم في النظام

---

## المحاسبة الأساسية

| العربي | English | الشرح |
|---|---|---|
| القيد المزدوج | Double-Entry | كل عملية = مدين يساوي دائن — أساس سلامة الدفاتر |
| مدين | Debit (Dr) | الجانب الأيسر للقيد — طبيعة الأصول والمصروفات |
| دائن | Credit (Cr) | الجانب الأيمن — طبيعة الالتزامات والإيرادات وحقوق الملكية |
| شجرة الحسابات | Chart of Accounts | الهيكل الهرمي لكل الحسابات (كود 5 خانات) |
| قيد اليومية | Journal Entry / Voucher (JV) | تسجيل عملية بأسطر مدين/دائن |
| دفتر الأستاذ | General Ledger | كشف حركة حساب واحد |
| ميزان المراجعة | Trial Balance | أرصدة كل الحسابات — اختبار التوازن |
| الميزانية العمومية | Balance Sheet | الأصول = الالتزامات + حقوق الملكية |
| قائمة الدخل | Income Statement / P&L | الإيرادات − المصروفات = صافي الربح |
| التدفق النقدي | Cash Flow | حركة النقد الفعلية (مختلف عن الربحية) |
| الرصيد الافتتاحي | Opening Balance | رصيد البداية عند اعتماد النظام — يرحّل كقيد |
| ترحيل | Posting | تثبيت المستند — بعده يدخل التقارير ولا يعدل |
| حساب تجميعي | Group Account | أب لا يقبل قيوداً مباشرة (isGroup) |
| طبيعة الحساب | Account Nature | debit/credit — يحدد اتجاه زيادة الرصيد |

## الذمم والتحصيل

| العربي | English | الشرح |
|---|---|---|
| الذمم المدينة (AR) | Accounts Receivable | ما يجب على العملاء |
| الذمم الدائنة (AP) | Accounts Payable | ما يجب للموردين |
| أعمار الديون | Aging (Buckets) | توزيع المستحق على 0-30/31-60/61-90/+90 من الاستحقاق |
| تاريخ الاستحقاق | Due Date | موعد السداد المتفق — أساس الأعمار (لا تاريخ الإصدار) |
| سند قبض | Receipt Voucher (RV) | استلام نقدية من عميل — خصم فاتورة أو على الحساب |
| سند صرف | Payment Voucher (PV) | دفع نقدية لمورد أو مصروف |
| تخصيص الدفعة | Payment Allocation | ربط السند بفاتورة — يخصم paid_amount ويرصّص الحالة |
| دفعة على الحساب | On-Account Payment | سند بلا ربط بفاتورة |
| كشف الحساب | Statement of Account | سجل كل التعاملات برصيد تراكمي — يبدأ بالافتتاحي |
| حد الائتمان | Credit Limit | سقف البيع الآجل لعميل |

## المبيعات والمشتريات

| العربي | English |
|---|---|
| فاتورة مبيعات | Sales Invoice (INV) |
| فاتورة مشتريات | Purchase Invoice (PINV) |
| عرض سعر | Quotation (QOT) |
| أمر شراء | Purchase Order (PO) |
| مردود المبيعات | Sales Return (SRT) |
| مردود المشتريات | Purchase Return (PRT) |
| فاتورة نقدي | Cash Invoice — قيدها على الخزنة |
| فاتورة آجل | Credit Invoice — قيدها على حساب الطرف |
| المجموع الفرعي | Subtotal |
| ضريبة القيمة المضافة | VAT |
| تكلفة المبيعات | COGS (Cost of Goods Sold) |
| الهامش الإجمالي | Gross Margin |

## المخازن والتصنيع

| العربي | English | الشرح |
|---|---|---|
| مستودع | Warehouse | موقع تخزين |
| حركة مخزون | Stock Movement | in / out / transfer / adjustment |
| تسوية جرد | Stock Adjustment | مطابقة الرصيد الدفتري مع الجرد الفعلي |
| تحويل | Transfer | نقل بين مستودعين |
| قائمة المواد | BOM (Bill of Materials) | وصفة الإنتاج: خامات لكل دفعة |
| أمر تشغيل | Work Order (WO) | أمر إنتاج — planned → in_progress → completed |
| إنتاج تحت التشغيل | WIP (Work in Process) | حساب 11302 — خامات صُرفت ولم تكتمل |
| بضاعة تامة الصنع | Finished Goods | 11303 |
| دفعة | Batch | وحدة إنتاج (quantity = عدد الدفعات × ناتج BOM) |
| الانحراف | Variance | الفرق بين المخطط والفعلي (كمية/تكلفة) |
| تحليل ABC | ABC Analysis | باريتو القيمة — A يسيطر على 80% |
| الراكد | Slow-Moving | بلا حركة خروج > 90 يوم |
| نقطة إعادة الطلب | Reorder Point | مستوى يستدعي الشراء |

## الموارد البشرية

| العربي | English |
|---|---|
| مسير الرواتب | Payroll Run (PAY) |
| الراتب الأساسي | Base Salary |
| البدلات | Allowances |
| الاستقطاعات | Deductions |
| العمل الإضافي | Overtime |
| صافي الراتب | Net Salary |
| قيد Gross-up | Gross-up Entry — مصروف بالإجمالي/مستحق بالصافي/استقطاعات |
| نهاية الخدمة | End of Service (EOS) |
| استحقاق EOS | Accrual — قيد الاعتماد (مصروف/مستحق) |
| تسوية EOS | Settlement — قيد الدفع (مستحق/خزينة) |
| الرصيد | Leave Balance |
| الحضور والانصراف | Check-in / Check-out |
| سماحية التأخير | Late Grace Period |

## CRM

| العربي | English | الشرح |
|---|---|---|
| عميل محتمل | Lead | لم يصبح عميلاً بعد |
| فرصة | Opportunity | صفقة محتملة بقيمة ومرحلة |
| خط المبيعات | Sales Pipeline / Funnel | المراحل: new → qualified → proposal → negotiation → won/lost |
| التقييم | Rating | ساخن/دافئ/بارد |
| التحويل | Conversion | Lead → Customer |
| القيمة المرجحة | Weighted Value | القيمة × الاحتمالية |
| آخر تواصل | Last Contacted At | يختم تلقائياً بالنشاط |
| Kanban | Kanban Board | أعمدة المراحل القابلة للسحب |

## النقدية

| العربي | English | الشرح |
|---|---|---|
| خزينة | Cash Box | موقع دفع مربوط بحساب دفتري (المفهوم الموحد) |
| الصندوق | Cash (GL) | 11101 |
| طريقة الدفع | Payment Method | نقدي / حوالة-محفظة / شيك |
| الشيك | Check | + رقم وتاريخ استحقاق |
| الأساس النقدي مقابل الاستحقاقي | Cash vs Accrual | نقدي = يقيد فوراً / آجل = استحقاق لاحق |

## النظام

| العربي | English |
|---|---|
| الصلاحيات | RBAC (Role-Based Access Control) |
| سجل التدقيق | Audit Log |
| المستأجر (شركة معزولة) | Tenant |
| تعدد العملات | Multi-Currency |
| العملة الأساسية | Base Currency |
| سعر الصرف | Exchange Rate (وحدات الأساسية لكل 1) |
| المعادل بالأساسية | Base Currency Equivalent |
| السنة المالية | Fiscal Year |
| التقويم الهجري | Hijri Calendar (أم القرى) |
| الترحيل (migration) | Database Migration |
| الوكيل الذكي | AI Agent |
| بطاقة الموافقة | Confirmation Card |
| حوارس العمل | Business Guards |

---

- العودة إلى **[الفهرس الرئيسي](../README.md)**

# خطة وحدة POS (نقطة البيع) — maghzaccount-pro v0.16.0

## القرارات المعتمدة (من المستخدم)
1. **إعادة استخدام `sales_invoices`** + ترقيم مستقل `POS-` + عمودا تمييز `is_pos`/`shift_id` + جداول ورديات جديدة
2. **نظام ورديات كامل** في v1 (فتح/إغلاق/فرق صندوق/تقرير Z)
3. **واجهة هجينة**: باركود + شبكة لمس مع تبويب
4. **دفع نقدي + آجل + مختلط**

## المعمارية

### نموذج البيانات — Migration `drizzle/0027_pos_module.sql` (idempotent)
- **`pos_shifts`**: id, company_id, cash_box_id (→cash_boxes), user_id (→users), opening_amount, closing_amount, expected_amount, difference, status('open'/'closed'), opened_at, closed_at, notes, audit cols + **unique partial index** `(user_id, company_id) WHERE status='open'` (وردية واحدة مفتوحة لكل كاشير)
- **`pos_payments`**: id, company_id, shift_id, invoice_id(→sales_invoices CASCADE), method('cash'/'credit'), amount, cash_box_id, reference, notes, audit cols — سجل دفعات كل فاتورة (أساس تقرير Z وفرق الصندوق)
- **`ALTER TABLE sales_invoices`**: `ADD COLUMN IF NOT EXISTS is_pos boolean DEFAULT false` + `shift_id uuid REFERENCES pos_shifts ON DELETE SET NULL` + partial index `(company_id) WHERE is_pos`
- تسجيل في: `drizzle/meta/_journal.json`، `pgliteAdapter.ts` MIGRATIONS، Drizzle schema جديد `src/core/database/schema/pos.ts` (+توسيع `sales.ts` بـ isPos/shiftId)، `drizzle/migrations.test.ts` (block جديد)، `backupTables.ts` + `BACKUP_PLAN` في dbHandler (النسختان — يفرضهما parity test؛ pos_payments قبل sales_invoices في delete ordering)
- **الترقيم**: نوع `pos_receipt` (بادئة `POS-` pad 6) في `getTableForDocumentType`/`getNumberColumnForDocumentType` (`src/core/api.ts:78-136`) + seed row في `seedDemoData.js` + TYPE_LABELS في DocumentSequencesPage

### تدفق الدفع (Checkout) — `posApi.checkout()`
نمط الطبقتين المعتمد في salesApi (dual-transport):
1. **قناة RPC مكتوبة `db:rpc:pos.checkout`** في `electron/dbHandler.js` (تُنشئ SQL في الـ main process مع صلاحية `pos.post` فقط) — **ضرورية لأن حرس `SQL_MODULE_TABLE_RULES` في `db:internal-transaction` سيرفض كتابة `sales_invoices` من كاشير لا يملك صلاحيات `sales.*`**
2. **مسار fallback** (PGlite/e2e/renderer) عبر `getDbAdapter()` — نفس SQL
3. الخطوات داخلياً (نفس عقد sales الحالي ذي الخطوتين):
   - `createPosInvoice`: CTE واحدة (رأس + سطور `snapshotLineUnit`) بـ `is_pos=true`, `shift_id`, `status='draft'`
   - `postPosSale`: معاملة ذرية واحدة (`runTransaction`) تضم: JE + ضمان صفوف stock + حركات خروج + خصم المخزون + flip الحالة → `paid` عند عدم وجود متبقٍ + `customers.balance += creditPart` + إدراج `pos_payments`
4. **قيد مختلط جديد** `buildPosSalePostingStatements` في `journalEntryGenerator.ts`: Dr حساب صندوق الكاشير (الجزء النقدي) + Dr 11201 Debtors (الجزء الآجل) / Cr 41101 مبيعات / Cr 21301 ضريبة — يطابق السلوك النقدي الحالي تماماً عند creditPart=0. الفاتورة تُخزَّن `payment_type='cash'` إذا سددت كاملاً وإلا `'credit'` مع `paid_amount=الجزء النقدي` (لا كسر فلاتر/شارات UI الموجودة)
5. **استخراج مساعدات مخزون مشتركة** `buildEnsureStockStatements`/`buildStockOutStatements`/`buildDecrementStockStatements` من `postInvoice` (L914-964) إلى ملف مشترك، وإعادة استخدامها في salesApi و posApi — إزالة تكرار مع بقاء اختبارات `sales/api.test.ts` حارساً ضد الانحدار

### الورديات — `posApi`
- `openShift(cashBoxId, openingAmount)`: INSERT + تحقق من عدم وجود وردية مفتوحة (partial unique index يفرضها)
- `closeShift(shiftId, countedAmount, notes)`: حساب `expected = opening + SUM(cash payments)` و `difference = counted - expected` (SELECT واحدة مجمعة) + `status='closed'` — **فرق الصندوق يُسجَّل فقط (تقريرياً) دون قيد JE تلقائي في v1**
- `getShiftSummary(shiftId)`: تقرير Z — عدد الفواتير، الإجماليات (إجمالي/خصم/ضريبة/صافي)، الدفعات حسب method، النقدي المتوقع/المعدود/الفرق + قائمة آخر الفواتير
- `getActiveShift()`, `getShiftsPaginated()` (نمط pagination المعتمد)

### RBAC — إضافة وحدة `'pos'` (القائمة الكاملة من الاستكشاف)
- `Permission` union + `ALL_PERMISSIONS` + `PERMISSION_GROUPS` (مجموعة "نقاط البيع") في `auth/types.ts`
- `FALLBACK_PERMISSIONS`: sales_rep/manager يحصلون على `pos.view/create/post/own`
- Module union في المواضع الأربعة: `usePermission.ts:28`, `router.tsx:142`, `layout.tsx:52`, `PermissionGate.tsx:5`
- Sidebar (menuItems + المجموعات desktop/mobile) + paletteItems + `SQL_MODULE_TABLE_RULES` في dbHandler (جداول pos للقراءة `pos.view|own`)
- i18n: قسم `pos` كامل في ar.json + en.json (~90 مفتاحاً) + `sidebar.pos` — التوازن مفروض باختبار i18n الموجود

### الواجهة
1. **`PosTerminalPage`** (`/pos` — **خارج AppLayout**: مسار شقيق تحت `ProtectedRoute` + `PermissionRoute module='pos'` كـ shell بـ `h-dvh` خاص):
   - شريط علوي: مؤشر الوردية النشطة (كاشير/صندوق/مدة) + خانة بحث/باركود (autofocus دائم، F2) + اختيار عميل + خروج
   - يمين: السلة (أسطر، +/- كمية، خصم سطري حسب الإعداد، حذف، الإجماليات، زر الدفع F9)
   - وسط/يسار: رقائق فئات + شبكة منتجات لمسية (بطاقات: اسم/سعر/شارة مخزون) + نتائج بحث
   - **الباركود**: `barcodeScanner.onScan()` (keyboard-wedge — غير مستخدم حالياً، POS أول مستهلك له) + Enter يدوي — البحث بـ barcode/sku/name_ar عبر استعلام مدمج مع المخزون (getProducts لا يجلب quantity — استعلام POS مخصص يجمع stock)
   - **مودال الدفع**: أزرار نقدي سريعة (المبلغ بالضبط/500/1000/5000)، المدخل → الباقي، اختيار نقدي/آجل/مختلط (مبلغ آجل)، عميل إلزامي للآجل، تأكيد Enter → checkout → عرض/طباعة الإيصال (إعادة طباعة آخر عملية)
   - **اختصارات لوحةية** (يدوية بنمط CommandPalette — Ctrl+K غير نشط خارج AppLayout فلا تعارض): F2 بحث، F3 عميل، F4 كمية، F6 حذف سطر، F9 دفع، F10 تعليق، Esc
   - **نبض الجلسة**: استخراج heartbeat من AppLayout إلى hook مشترك `useSessionHeartbeat` يستخدمه POS أيضاً (وإلا لن تنتهي الجلسة داخل POS)
   - **قابلية الاسترداد**: تعطل بين الإنشاء والترحيل يترك draft قابل للمعالجة من شاشة الفواتير — مسار استرداد موثق
2. **`posStore`** (Zustand persist `maghzaccount-pos`): أسرة السلة، عميل، **تعليق/استئناف عربة** (hold/resume)، إعدادات محلية — السلة تنجو من تحديث الصفحة
3. **`PosShiftsPage`** (`/pos/shifts` داخل AppLayout): جدول ورديات (مفتوحة/مغلقة) + مودال فتح (صندوق + رصيد افتتاحي) + مودال إغلاق (المعدود → المتوقع → الفرق) + عرض/طباعة تقرير Z (80mm)
4. **`PosSettingsPage`** (`/pos/settings`): الصندوق الافتراضي، تذييل الإيصال، طباعة تلقائية، السماح بتعديل السعر/الخصم — تُخزَّن في جدول `settings` بمفاتيح `pos.*` (نمط `invoice.showVat` الحالي) + قراءتها في `useSettings`

### طباعة الإيصال
توسيع `thermalPrinter.ts` (غير مستهلك حالياً): `printReceipt(data)` بقالب 80mm RTL (Cairo) — رأس الشركة، رقم POS، الأسطر، الإجماليات، طريقة الدفع والباقي، QR اختياري، تذييل مخصص، قطع ورق — fallback لـ `window.print` (يعمل في Electron). جسر `electronPrinter` IPC للطابعات الحرارية الفعلية ودرج النقود: **v1.1** (الموجود dead code).

## المراحل التنفيذية

**A. الأساس (Foundation)**: migration 0027 + Drizzle schema + journal/pglite/backup registrations + ترقيم `pos_receipt` + seed (قسم 32: sequence + وردية مغلقة تجريبية) + RBAC كامل + i18n + `migrations.test.ts`
**B. طبقة API**: `posApi` (shifts/checkout/Z-report/استعلام منتجات POS) + `buildPosSalePostingStatements` + استخراج مساعدات stock المشتركة + RPC `pos.checkout`/`pos.openShift`/`pos.closeShift` في dbHandler + preload + `validation.ts` (zod schemas) + `posApi.test.ts`
**C. إدارة الورديات**: `posStore` + `PosShiftsPage` + مودالات فتح/إغلاق + تقرير Z + router
**D. شاشة الكاشير**: `PosTerminalPage` + مكوناته (شريط البحث/الشبكة/السلة/مودال الدفع/الإيصال) + الاختصارات + `useSessionHeartbeat` المستخرج + `posStore.test.ts`
**E. الإعدادات والتشطيب**: `PosSettingsPage` + تذييل الإيصال + audit logs لكل عملية + palette + تحديث AGENTS.md (وحدة 13 + القواعد الذهبية)
**F. التحقق الشامل**: `npx eslint src` (0/0) + `tsc -b` (0) + `vitest run` (كلها ✓ مع اختبارات POS الجديدة: api/store/رياضيات الوردية/الشاشة) + `npm run build` + `db:check` + `db:reset:force` + `e2e/19-pos.spec.ts` (دخول → فتح وردية → بيع باركود → دفع نقدي → تحقق فاتورة paid + مخزون منقص → إغلاق وردية → Z)

## خارج نطاق v1 (موثقة للمرحلة القادمة)
- مرتجعات من داخل شاشة POS (تُدار عبر شاشة المرتجعات الموجودة المرتبطة بـ invoice_id)
- وضع offline بطوابير مزامنة، الطابعة الحرارية الفعلية/درج النقود عبر IPC، قيد فرق الصندوق التلقائي، terminals متعددة، بطاقات دفع إلكترونية

**~25 ملفاً** (15 جديد + 10 معدل)، كلها تتبع أنماط الكود الموثقة أعلاه بدون أي مكتبات جديدة.
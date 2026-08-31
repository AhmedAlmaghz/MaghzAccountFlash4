# خطة تطوير وحدة HR الاحترافية — v0.8.0

> **التاريخ**: 2026-08-30 | **الحالة**: معتمدة للتنفيذ
> **النطاق**: ~25 ملف معدل/جديد، migration واحدة، صفر حذف API (توافق كامل)

## المبادئ الحاكمة (قرارات معتمدة)

| القرار | المعتمد |
|---|---|
| قيد الرواتب | **Gross-up كامل** (مدين: مصروف الرواتب بالإجمالي / دائن: رواتب مستحقة بالصافي + دائن: استقطاعات مستحقة) |
| قيد نهاية الخدمة | **مرحلتان** — استحقاق عند الاعتماد، تسوية عند الدفع عبر خزنة |
| أرصدة الإجازات | **فرض صارم** — الاعتماد يُرفض تلقائياً عند التجاوز |
| مكونات الرواتب | **مربوطة** بمحرك الرواتب (تعبئة تلقائية قابلة للتعديل) |
| الحضور | **اشتقاق تلقائي** للتأخير والأوفر تايم مع تجاوز يدوي |

**القاعدة المركزية**: كل الحسابات المالية تُحسب في طبقة الـ API/المحرك (server-side) — الواجهة والوكيل الذكي مجرد مستهلكين لنفس `hrApi`. لا يوجد `netSalary` أو `eosAmount` واحد يُخزَّن من قيمة العميل.

## المشاكل المكتشفة (Baseline)

### مصدر الحقيقة مشتّت
| العملية | أين تُحسب الآن | المشكلة |
|---|---|---|
| صافي الرواتب | `PayrollPage.tsx` (client) | API يخزن أرقام العميل حرفياً + أداة AI تحسب نسخة ثالثة |
| نهاية الخدمة | `EndOfServicePage.tsx` (client) | أداة AI ترسل أصفاراً — سجلات فارغة مالياً |
| أيام الإجازة | `LeavesPage.tsx` (client) | لا تحقق تواريخ/تداخل خدمياً |
| الأوفر تايم | `AttendancePage.tsx` (client) | 8 ساعات hardcoded |

### فجوات حرجة
1. ترحيل الرواتب لا ينشئ قيداً محاسبياً (status flip فقط)
2. لا أرصدة إجازات إطلاقاً
3. لا حراس آلة حالة (حذف معتمدة/إعادة ترحيل/حذف موظف له بيانات = CASCADE فقدان صامت)
4. `payroll_components` يتيم — لا أحد يستهلكه
5. مسيرة نفس الشهر تتكرر (لا UNIQUE)
6. لا ربط حضور↔رواتب
7. `reportTools.ts:1255` يستخدم عمود `days_count` غير موجود (الصحيح `days`)

### Bugs أدوات AI
- `hr.create_employee` بصلاحية `inventory.create` | `search.employees` بصلاحية `inventory.view`
- إحالات لأدوات غير موجودة: `hr.get_leaves`, `hr.get_payroll_runs`, `hr.get_end_of_services`, `settings.get_payroll_components`
- `hr.process_payroll_flow` يُلزم النموذج بحساب netSalary يدوياً + بلا rollback
- `search.leaves`: 8 سجلات substring فقط (غير fuzzy)

---

## 📦 Phase A — الأساس

### A1. Migration `drizzle/0014_hr_professional.sql` (idempotent)
1. **حسابات جديدة** (لكل شركة، `WHERE NOT EXISTS`):
   - `215` مستحقات الموظفين (مجموعة التزامات)
   - `21501` رواتب مستحقة الدفع | `21502` استقطاعات مستحقة | `21503` مستحقات نهاية الخدمة
   - `52501` مصروف نهاية الخدمة
2. **مفاتيح default_accounts (4)**: `default_salaries_payable`, `default_payroll_deductions`, `default_eos_payable`, `default_eos_expense` — في migration + كلا الـ seeds + `core/types.ts` + `journalEntryGenerator.fallbackMap` + `applyDefaultTemplate`
3. **أعمدة**: `end_of_service.cash_box_id` + `end_of_service.paid_at` + `payroll_lines.overtime_hours`
4. **UNIQUE**: `uq_attendance(company_id, employee_id, date)` مع dedupe آمن + `uq_payroll_runs_period ON (company_id, month, year) WHERE status IN ('draft','posted')`
5. **إعدادات سياسات HR** (بذور لكل شركة): `hr.leave.annualDays=21`, `hr.leave.sickDays=30`, `hr.leave.emergencyDays=30`, `hr.overtimeRate=1.5`, `hr.standardWorkHours=8`, `hr.lateGraceMinutes=15`, `hr.eos.firstYearsMultiplier=0.5`, `hr.eos.beyondYearsMultiplier=1`
6. `_journal.json` idx=14 + `pgliteAdapter.MIGRATIONS/ACCOUNTS/DEFAULT_ACCOUNTS`

### A2. محرك HR النقي `src/modules/hr/payrollEngine.ts` (Pure Functions)
- `computeLeaveDays(start, end)` — أيام شاملة، يرفض end < start
- `computePayrollLine(emp, components, attendanceOvertime, policy, overrides)` — أساسي من الموظف + مكونات (fixed|percentage من الأساسي) + أوفر تايم = ساعات × (الأساسي/30/ساعات العمل) × معدل
- `computeEos(hireDate, terminationDate, lastSalary, reason, policy)` — سنوات بدقة منزلتين + نصف شهر×5 ثم شهر (معامِلات قابلة للضبط)
- `deriveAttendance(checkIn, checkOut, policy)` — isLate + overtimeHours

---

## 🏗️ Phase B — توحيد الـ API

### النمط المعماري
- قراءة معقدة جديدة (previewPayrollRun, getLeaveBalances, previewEndOfService) → `adapter.query` مباشرة (بلا RPC جديد — تعمل في البيئات الثلاث)
- عمليات مالية متعددة الجداول (postPayrollRun, EOS approve/pay, leave approve) → `runTransaction` ذرية (SELECT FOR UPDATE + JE + status)
- توسيع `SQL_MODULE_TABLE_RULES`: `transactions`/`journal_entries` بصلاحيات كتابة `hr.create/hr.edit` (سابقة manufacturing)
- RPC جديد وحيد: `hr.deletePayrollRun` (draft-only — للـ rollback)

### الحراسة الجديدة (server-side)
| العملية | الحراسة |
|---|---|
| `createLeave` | أيام محسوبة خدمياً + رفض end<start + **رفض التداخل** |
| `updateLeaveStatus` | آلة حالات + **فرض رصيد صارم** (قفل صف، رسالة بالمتبقي) + approvedBy فعلي |
| `deleteLeave` | pending/rejected فقط |
| `deleteEmployee` | رفض إذا له مسيرات/إجازات/حضور/EOS + اقتراح تعطيل |
| `createPayrollRun` | **إعادة حساب net لكل سطر** + total = Σ net + رفض تكرار الفترة |
| `postPayrollRun` | حارس draft + **قيد Gross-up ذري**: مدين 52101 إجمالي / دائن 21501 صافي / دائن 21502 استقطاعات |
| `createEndOfService` | الخادم يجلب الموظف ويحسب — قيم العميل تُهمَل |
| `updateEndOfServiceStatus` | draft→approved: قيد استحقاق (مدين 52501/دائن 21503) • approved→paid(cashBoxId): قيد تسوية (مدين 21503/دائن حساب الخزنة) |
| `saveAttendance` | اشتقاق isLate/overtime خدمياً + on_leave مسموح |

### إصلاحات جانبية
- `reportTools.ts:1255`: `days_count` → `days`

---

## 🖥️ Phase C — الواجهات

| الشاشة | التغيير |
|---|---|
| PayrollPage | زر "معاينة تلقائية" → `previewPayrollRun` (قابل للتعديل) — حذف calculateNet المحلي |
| LeavesPage | بطاقة رصيد لحظية لكل نوع + أخطاء رصيد بأرقام |
| AttendancePage | حذف الاشتقاق المحلي + on_leave + تلميح تلقائي |
| EndOfServicePage | حذف المعادلة المحلية + معاينة + مسار "دفع" مع CashBoxSelect |
| EmployeesPage | DepartmentSelect (جدول departments مزروع) + رسائل حراس الحذف |
| HrPage | نص القيد يصبح صادقاً |
| HrSettingsPage (جديدة) | سياسات HR عبر settings + route + sidebar |

---

## 🤖 Phase D — أدوات الوكيل الذكي

### إصلاحات
1. صلاحيات: `hr.create` / `hr.view` + RBAC دقيق (create/edit/delete)
2. إحالات الأدوات الوهمية → أدوات حقيقية
3. `search.leaves`/`search.attendance` → fuzzySearch + 200
4. إصلاح `days_count`

### أدوات جديدة
| الأداة | النوع |
|---|---|
| `hr.preview_payroll` | read |
| `hr.generate_payroll_run` | write (خطوط محسوبة تلقائياً) |
| `hr.get_leave_balances` | read |
| `hr.save_attendance` | write |
| `hr.pay_end_of_service` | write (cashBoxId) |
| `settings.get_payroll_components` | read |
| `hr.process_payroll_flow` (إعادة كتابة) | wizard: preview→create→post مع rollback حقيقي |

### Prompt + اقتراحات
- قواعد 28–30: "الرواتب عبر preview/generate فقط" / "افحص الرصيد قبل الموافقة" / "EOS يحسبها النظام"
- TOOL_ROUTES دقيقة + مفاتيح i18n الناقصة

---

## ✅ Phase E — الاختبارات والتحقق

1. `payrollEngine.test.ts` + توسيع `hr/api.test.ts` + tests للأدوات
2. سكربت cjs على PG حقيقي داخل ROLLBACK (قيود الرواتب/EOS/منع التجاوز)
3. `tsc -b` 0 | `eslint --max-warnings=0` 0 | `vitest` | `build` | `db:check` | `db:reset:force`
4. e2e: تحديث `13-hr-module` + HrSettingsPage smoke
5. i18n متوازن + تحديث AGENTS.md

---

## ⚠️ مقايضات مدروسة

1. **runTransaction بدل RPC جديد** للمالية — SQL واحدة للبيئتين، توسيع قاعدة صلاحيات JE لـ HR (سابقة موثقة)
2. **معادلة EOS محفوظة** (نصف/كامل شهر) لكن خدمية وقابلة للضبط — فقه قانون العمل اليمني خارج النطاق
3. **unpaid بلا رصيد** — النوع الوحيد غير المحدود
4. إدارة الأقسام CRUD خارج النطاق — ربط قراءة فقط

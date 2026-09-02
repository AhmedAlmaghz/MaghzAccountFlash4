# البنية المعمارية

> نظرة تقنية على بناء النظام — موجهة للمطورين والجهات الفنية

---

## نظرة عامة على الطبقات

```
┌─────────────────────────────────────────────────────────┐
│  electron/main.js          الطبقة الرئيسية (Main Process)  │
│  ├── dbHandler.js          ├─ Sessions + RBAC (طبقة 2)    │
│  │                         ├─ SQL Whitelist + Guards     │
│  │                         ├─ Typed RPC (db:rpc:*)       │
│  │                         └─ pg.Pool                   │
│  ├── aiHandler.js          └─ AI provider + مفتاح API    │
│  └── preload.js/.cjs       جسر IPC (سطح آمن مكشوف)        │
├─────────────────────────────────────────────────────────┤
│  src/                      الواجهة (Renderer — React 19)  │
│  ├── app/                  ├─ Router + Layout + Wizard    │
│  ├── core/                 ├─ ui/ (Design System)        │
│  │                         ├─ database/ (adapters)       │
│  │                         ├─ i18n/ (ar/en)              │
│  │                         └─ utils/ (format, validation) │
│  └── modules/              └─ 11 وحدة ERP منفصلة          │
├─────────────────────────────────────────────────────────┤
│  PostgreSQL / PGlite       طبقة البيانات (58 جدولاً)       │
└─────────────────────────────────────────────────────────┘
```

---

## الواجهة (Renderer)

### القرارات المعمارية الأساسية

| القرار | التفصيل |
|---|---|
| **TypeScript صارم** | `tsc -b` بلا أخطاء — 0 `any` تقريباً |
| **Functional Components فقط** | مع Hooks — لا class components (إلا ErrorBoundary عمداً) |
| **Zustand للحالة المشتركة** | متاجر: auth, app (sidebar/theme/lang/company) |
| **React Router 7** | HashRouter في Electron / BrowserRouter على الويب |
| **Server-side pagination** | 21 صفحة تُرقّم من الخادم (LIMIT/OFFSET) — لا تحميل آلاف الصفوف |
| **تحميل كسول للمكتبات الثقيلة** | jspdf/xlsx/recharts في chunks منفصلة لا تُحمّل إلا عند الضغط |

### بنية الوحدات (module-per-domain)
```
src/modules/<module>/
├── api.ts          ← كل SQL/استدعاءات الوحدة
├── types.ts       ← أنواعها
├── hooks/         ← useXxx + useXxxPaginated
├── components/    ← صفحاتها
└── index.ts       ← barrel export
```
11 وحدة: accounting, sales, purchases, inventory, manufacturing, hr, crm, reports, ai, auth, core (+ settings داخل core/api).

### نظام التصميم (core/ui)
- **Tailwind CSS 4** + `dark:` + `rtl:` — لا CSS مخصص تقريباً
- **مكونات أساسية مغلفة بـ React.memo**: Button, Input, Modal, Table, Card
- **Table مزدوج**: جدول أعمدة على سطح المكتب + **بطاقات على الجوال** (mobile: title/subtitle/meta/status)
- **SmartSelect + 18 حقلاً ذكياً**: بحث نصي + شارات meta (سعر/باركود/رصيد) + `onItemSelect` يعيد الكائن كاملاً (تعبئة الأسعار تلقائياً)
- **Modal بأحجام 8** (sm → full) عبر createPortal

### i18n
- ملفان متطابقان بنياً: `ar.json` / `en.json` (2500+ مفتاح متوازن)
- مفاتيح هرمية: `sales.invoice.title`
- **اختبار توازن آلي**: EN.count === AR.count وإلا فشل CI
- تنسيق العملة/التاريخ من **إعدادات الشركة الحية** (`useFormatters`) — تقويم هجري (أم القرى) عند الاختيار

---

## قناة الاتصال IPC — ثلاث دوائر أمان

```
Renderer                    Main Process
─────────                   ─────────────
window.electronDB._exec  →  db:internal-query     (raw محمي لكل statement)
window.electronDB.<rpc>  →  db:rpc:<domain>.<fn>  (typed RPC — SQL يؤلف هنا فقط)
window.electronAuth.*    →  auth:*                (جلسات + rate-limit)
window.electronAI.*      →  ai:*                  (مزود AI + المفتاح هنا فقط)
```

### 1) Raw SQL Escape Hatch (محمي)
`_exec`/`_execBatch` — لكل statement في modules:
- `getSession` (صلاحية الجلسة)
- `isSqlAllowed` (قائمة بيضاء الجداول + أنماط ممنوعة)
- `assertSqlAuthorized` (RBAC على مستوى الجدول/الفعل)

### 2) Typed RPC (الأولوية)
`db:rpc:*` — **80 قناة مسجلة**: accounting, inventory, contacts, core, crm, manufacturing, hr
- **Renderer يرسل payload منظماً فقط — لا SQL يعبر IPC**
- الـ SQL يُؤلف في main process بالكامل (compose → paramCount → validate)
- **session-derived scoping**: companyId/created_by تُستخلص من الجلسة — لا تُقبل من الواجهة (يمنع العبث عبر الشركات)

### 3) قنوات مخصصة
- `auth:*` (login/logout/session — brute-force protected)
- `ai:*` (chat stream + persistence + rename)
- backup/seed/reset

---

## طبقة البيانات

### Adapters (نمط Strategy)
```ts
getDbAdapter(): DbAdapter
├── electronPgAdapter   ← Electron + PG متاح (RPC/IPC)
└── pgliteAdapter       ← متصفح (PGlite WASM محلي)
```
الواجهة `DbAdapter` واحدة: query/transaction/createXxx/updateCompany... — كل الوحدات تستهلكها بلا معرفة بالوضع.

### SQL_MODULE_TABLE_RULES (مثال دفاع في العمق)
```
leads/opportunities/tasks/activities:
  read  ← crm.view | crm.own
  write ← crm.create | crm.edit | crm.post
currencies/units/vat_settings (مرجعية):
  readAny (كل الوحدات) / write ← أي module.create
stock_movements:
  write ← inventory.* + manufacturing.*  (إكمال أمر تشغيل يكتب مخزوناً)
audit_logs: writeAny (كل business flow) / read ← admin فقط
```

### الترحيلات (Migrations)
- Drizzle + `drizzle/00NN_*.sql` يدوية idempotent (`IF NOT EXISTS` / DO $$ guards)
- **additive-only** — لا DROP إلا لكيانات متقاعدة موثقة (banks/0002، جداول CRM الميتة/0015)
- اختبارات migrations تحمي: journal mirrors files، additive، أعمدة متوقعة
- PGlite يحمل قائمة MIGRATIONS يدوية يجب مزامنتها (Electron يكتشف تلقائياً)

---

## قواعد الكود الذهبية (ملخص)

| القاعدة | لماذا |
|---|---|
| `::uuid`/`::timestamptz` casts على كل معامل | منع أخطاء استنتاج أنواع PG |
| `toDateString()` لا `String(date)` | Date object → locale لا يقرأه PG (فخ متكرر) |
| `COALESCE(x, 0)` على nullable | NULL + رقم = NULL |
| CTE واحدة ذرّية > استعلامات متتالية | لا نوافذ سباق |
| `UPDATE ... RETURNING` للترقيم | زيادة ذرّية آمنة للتزامن |
| `SUM(journal_entries)` مصدر الأرصدة الوحيد | لا احتساب مزدوج |
| مواصفات التاريخ والأرقام من إعدادات الشركة | كل الشاشات موحدة |
| اختبار عقد SQL بparams لا بstring | parameterized لا يظهر literal |
| كاش module-level يُصفّر بين اختبارات | تسرب حالة بين الاختبارات |

---

## الأداء (أرقام مبنية)

| التحسين | الأثر |
|---|---|
| batch INSERT واحد بدل N استعلامات | BOM/فاتورة بـ N سطر = 1 round-trip |
| `json_agg ... FILTER` تضمين السطور | getBomById = استعلام 1 بدل 2 |
| فهرس مركب `(company_id, user_id, updated_at)` | درج جلسات AI فوري |
| بث مُخنّق rAF في الدردشة | O(n) بدل O(n²) في streaming |
| React.lazy للـ ChatWidget | التخطيط لا يحمل الدردشة حتى تحتاجها |
| manualChunks (pdf/charts/excel منفصلة) | الحمل الأول خفيف |

---

## الاختبارات

| النوع | الحجم | ماذا يغطي |
|---|---|---|
| **Vitest** | 1300+ / 83 ملفاً | API contracts (SQL+params)، المحركات (payroll/duplicate/suggestions)، المكونات، i18n توازن، migrations |
| **Playwright e2e** | 83 / 14 ملفاً | login، دورة فاتورة، سند مربوط بفاتورة (ping live DB)، صفحات الوحدات |
| **فحوص حية ROLLBACK** | سكربتات ad-hoc | إعادة إنتاج أخطاء PG الحقيقية داخل BEGIN...ROLLBACK بلا تلويث |

### أوامر التحقق
```bash
npm run lint          # 0 errors, 0 warnings
npx tsc -b            # 0 errors
npm run test          # 1300+ pass
npm run test:e2e      # 83 pass (يحتاج قاعدة تطوير + e2e:reset)
npm run db:check      # Drizzle ↔ SQL بلا انحراف
npm run preflight     # lint + tsc + tests دفعة
```

---

## بناء النشر

```bash
npm run build              # ويب (Vite → dist/)
npm run electron:build     # مثبت Windows portable (electron-builder)
```
- التطبيق **portable** (ملف exe واحد) — يقرأ إعدادات PG من معالج التهيئة
- headers تخزين أصول مع أسماء hashed (immutable) — مع شفاء stale-deploy تلقائي في main.tsx

---

## روابط ذات صلة
- **[مرجع قاعدة البيانات →](03-database.md)**
- **[الأمان بالتفصيل →](02-security.md)**
- **[مرجع API →](04-api-reference.md)**

---

- العودة إلى **[الفهرس الرئيسي](../README.md)**

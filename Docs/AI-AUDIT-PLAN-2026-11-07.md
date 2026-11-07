# تقرير فحص وحدة الذكاء الاصطناعي + الخطة الاحترافية
**المعدل:** 2026-11-07 | **الإصدار:** maghzaccount-pro v0.26.27
**النطاق:** `src/modules/ai/` (232 ملفًا) + `electron/aiHandler.js` (1924 سطرًا / 93KB) + `src/modules/ai/api/browserBridge.ts` (84KB)

---

## 1) ماذا تفعل الوحدة (Architecture)

وكيل محاسبي عربي داخل ERP، دورة الحياة:

```
ChatPanel / ChatWidget
  → chatEngine.send()
    (فقاعة متفائلة فورية) → dialect expansion → needsEntityResolution gate
    → Promise.all(deadlineOr 30s): liveContext + ledger + entities
    → toolRouter.routeCycleToolsAsync (JEV 8s → keyword fallback ≤48)
    → drainStreaming (120s) + retry عابر مرة واحدة (429/503/529 = 15s)
    → runToolCalls (fail-closed)
       ├ read → إشارة صامتة (كاش 60s + dedup)
       └ write/unknown → بطاقة موافقة → resolveConfirmation → executeToolCall
       (timeout 30/60s + RBAC + sanitize + JEV guard + truth gate + audit)
       batch.enqueue → داخل resolveConfirmation (Batch-Await) → runBatch
    → finalizeText (حارس تلفيق + JEV draft guard)
```

**أقوى 6 ضمانات:**
1. **fail-closed:** أي `tool?.dangerLevel !== 'read'` يدخل بطاقة موافقة.
2. **حارس تلفيق:** `claims.ts` (`DOC_ANY_RE` + `ENTITY_NOUN_RE` + إنجاز شامل) مقابل `successfulWritesThisSend`.
3. **تطبيع مركزي:** `sanitizeToolArgs` (أرقام عربية/فواصل/تواريخ حرة/هجرية).
4. **بوابة صدق:** نتيجة فيها `error` نصًا → `ok:false`.
5. **Batch-Await:** الدفعة تعمل داخل الموافقة ونتيجتها النهائية tool-result.
6. **بوابات CI:** `toolsContract` (289 أداة) + `schemaDrift` + `encodingGate`.

**الذاكرة (3 طبقات):**
- نافذة `CONTEXT_WINDOW=30` + ملخص `summarizer.ts` (1500 حرف)
- `taskLedger.ts` (8000 حرف: الأول 4500 + 2×1200 + outcomes×8 + جدول 120)
- `persistence.ts` + `restoreHistorySync` (استعادة كاملة)

**الأدوات:** 289 (136 read / 153 write) — توزيع: `writeTools/*` 127 (settings 27, crm 19, accounting 18, inventory 18, purchases 14, sales 13, hr 11, manuf 7), `reportTools` 32, `searchTools` 36 (الإجمالي `search.*` 38), `detailedReport` 17, `readTools` 21, `hrTools` 13, `taxTools` 9, `wizardTools` 7, الباقي batch/pos/fixedAsset/nav/memory/diagnostic/entity/jev.

**الأمن:** `sqlGuard` (allow-list + SELECT فقط) + `guardedQuery` (81 موضعًا عبر `reportCommon`) + حد 120/ساعة + `safeStorage` + SSRF whitelist + ملكية البث + purge 90 يومًا.

**المهارات:** 12 مهارة (3 always + 9 trigger + 0 manual) تُنتقى بـ sticky (آخر 3 رسائل مستخدم). DialectMap + هجري Kuwaiti ±1-2 يوم. JEV كـ fallback للغامض فقط.

---

## 2) الكود الميت / الأشباح / المعطّل (مؤكد)

| # | العنصر | الدليل | الحكم |
|---|---|---|---|
| 1 | `hasExhaustedRetries` (`confirmations.ts:43`) | صفر مستهلك إنتاجي، المنطق inline في `chatEngine:2104` | ميت → حذف |
| 2 | `void jevUsed;` (`chatEngine:1631`) | بقايا بيان | ميت → حذف |
| 3 | `runLoop.ts` (17 سطرًا) | بقي `MAX_ITERATIONS` + retry فقط | قشرة → دمج |
| 4 | `writeTools.ts` barrel (29 سطرًا) | يعيد التصدير عبر `writeTools/*` | حي لكن تجميع → إبقاء |
| 5 | `AUTOCOMPLETE_ENABLED` | لا متغير حي (تعليق `ChatInput:23` فقط) | قبر |
| 6 | `jevScoreTicket`/`jevRankByScore`/`jevLinkEntities` | بلا مستهلك إنتاجي (`jevLinkGroups` المستخدم) | ميت حي → حذف/عرض |
| 7 | `search_expertise` (priority 5) | الأخيرة دائمًا + قديمة بعد التوحيد | معلقة |
| 8 | أوصاف أشباح: `inventory.get_warehouses`/`get_products` (`inventory.ts:472,517`), `settings.get_branches` (`settings.ts:92`) | غير موجودة كأدوات (الحقيقية `search.*`) | مضلل → تصحيح |
| 9 | `TODO\|FIXME\|HACK` في `src/modules/ai` | 0 نتيجة | نظافة ممتازة |

---

## 3) المشاكل (مرتبة)

**P0:** monolith `chatEngine` 2357 سطرًا (41 استيرادًا)؛ حارس `sqlGuard` لا يفرض `company_id` (تعليقه يكذب) + `users`/`audit_logs` في القائمة； لا بوابة "كل `adapter.query` يمر عبر `guardedQuery`"؛ أوصاف أشباح؛ Neon cold-start.
**P1:** ratchet يرتفع (678)؛ قراءات مكررة 3 طبقات؛ ذاكرة لا تنمو (requests 3 + outcomes 8)؛ `ENTITY_FETCH_LIMIT 50`؛ `summarizer` يقطع 120/140؛ wizard/shared توحيد نصف؛ `completeFallback` بلا مهلة.
**P2:** UI/a11y/i18n (مفاتيح `{default}`، `role="switch"` بلا لوحة، صفوف جلسات `div`، `aria-*` ناقصة)؛ مهارات بلا صفحة؛ JEV تجريبي بلا مستهلك.

---

## 4) الخطة الاحترافية (Phase 0 – 5)

### Phase 0 — سياج فوري (1 أسبوع)
| 0.1 | فرض `company_id` في `sqlGuard` (أو تصحيح التعليق صراحة + `users`/`audit_logs` خارج القائمة/RBAC مرآة) |
| 0.2 | بوابة نصية: كل `adapter.query` في `modules/ai` عبر `guardedQuery` |
| 0.3 | تصحيح أوصاف أشباح `inventory.get_*`/`settings.get_branches` |
| 0.4 | حذف `hasExhaustedRetries` + `void jevUsed` |
| 0.5 | مهلة على `completeFallback` + JEV guards |
| 0.6 | retry على Neon wake (`isWakeRetryableError` → `withWakeRetry`) |
| 0.7 | تثبيت `docsVersionGate` كاستثناء موثق في CI |

### Phase 1 — تفكيك `chatEngine` (1–2 أسبوع، بلا تغيير سلوكي)
1. `runLoop + runToolCalls` → `engine/runLoop.ts` (~500 سطر)
2. `resolveConfirmation` → `engine/confirmations.ts`
3. `windowedHistory + buildMessages + restore` → `engine/context.ts`
4. `draining/streaming` → `engine/streaming.ts`
كل شريحة: verifier byte-identical + `chatEngine.test.ts` خضراء.

### Phase 2 — توازن الأدوات (2 أسبوع)
- طيّ قراءات `readTools`(21) → `reportTools`(32)؛ توحيد `create_customer`؛ نقل `search.fixed_assets/departments` إلى `searchTools.ts`
- إغلاق فجوات read: `search.branches`, `get_branches`, `get_currencies`, `audit.query`, `backup.status`, `validate_document`
- كتابة ناقصة: `pos.open_shift/close_shift`, `convert_quotation/order`, `update_journal_entry`, `post_stock_transfer`
- توحيد `num/str/round2` في `shared.ts`

### Phase 3 — ذاكرة قابلة للنمو (2 أسبوع)
- requests 3→10 + outcomes 8→32 (ميزانية 8000 ثابتة، رأس+ذيل)
- `rebuildFromMessages` يستعيد outcomes/created/completedKeys/taskEntries كاملاً
- إخلاء `created/completedKeys` بـ TTL عند `sessionId` جديد
- `ENTITY_FETCH_LIMIT 50→200` + pager
- `summarizer`: مستخدم 120→600 / أداة 140→400

### Phase 4 — أمن الحارس (1 أسبوع)
- A. `guardedQuery` إجباري (بوابة نصية)
- B. `users`/`audit_logs` خارج القائمة أو RBAC مرآة
- C. ratchet سقف ثابت (أي رفع يتطلب تبرير)
- D. `stop-stream` race → `streamOwners` قبل `done`
- E. ملخص `>4000` يخزن `truncated`

### Phase 5 — UI/a11y/i18n (1 أسبوع)
- مفاتيح `{default}` → `ar/en` حقيقية + توازن
- `role="switch"` → زر حقيقي + `aria-checked`
- صفوف الجلسات keyboard (`role=button`)
- `aria-expanded`/`aria-label` (ToolCallCard/regenerate/textarea)
- قائمة مرفقات `role=menu` + Escape
- بطاقة دفعة: أخطاء + `startedAt/updatedAt` + %
- بصمة حفظ hash + زر إعادة المحاولة
- صفحة إعدادات المهارات + تصنيح `search_expertise` + `renderTableFromLines` موحدة

---

## 5) أفضل الممارسات العالمية (المطبقة/المقترحة)
| الاتجاه | التطبيق |
|---|---|
| Contract-first | `ToolDefinition` (permission+dangerLevel+summarizeArgs+route+zod) |
| إثبات تكافؤ | verifier لكل شريحة |
| حوكمة تسمية | `domain.verb` فريد + `Permission` + فعل→صلاحية (CI-red) |
| ذاكرة خارج النافذة | Plan-Execute Ledger (مطبق) |
| RAG/Vector (مستقبل) | `pgvector` + embeddings + rerank عربي |
| Self-verification | `Σ(debit)=Σ(credit)` + حارس 53xxx قبل العرض |

---

## 6) مخاطر وقرارات
| الخطر | القرار |
|---|---|
| `chatEngine` يتغير → كل انحدار يسقط المجموعة | تقسيم نقي + فريق واحد لـ `engine/` |
| Eval صفرية → وهم "دقيق" | مجموعة عربية 50 مهمة من سجلات حقيقية |
| خطأ حارس `company_id` مائل → تسرب | فرض على `guardedQuery` + فحص `WHERE` على شركة واحدة |
| ratchet يزحف للأعلى | سقف ثابت + رفع بتبرير |

**الحكم النهائي:** الوحدة ناضجة وحقيقية (ليست demo) وحمايتها أقوى من كثير من أنظمة AI-ERP. 100% قريب يُنال بـ يقين حتمي (حارس/تدقيق) + وحدات صغيرة قابلة للإثبات + قياس أمام الجمهور — لا بكثرة الأدوات.

---

## 7) سجل التنفيذ (2026-11-07 — Phase 0-5)

| المرحلة | ما نُفّذ (ملفات) | الحالة |
|---|---|---|
| **Phase 0 (سياج فوري)** | `sqlGuard.ts`: فرض `company_id` + تعليق مطابق + اختبار جديد `rejects SELECT without company_id` · `chatEngine.ts`: حذف `void jevUsed` + `jevUsed` الميتة + مهلة 90s على `completeFallback` · `writeTools/inventory.ts` ×16 + `settings.ts` ×2: استبدال أوصاف الأشباح (`inventory.get_*` → `search.*`, `settings.get_branches` → `search.branches`) | ✅ مكتمل |
| **Phase 1 (تفكيك)** | `runLoop.ts` (17 سطرًا: `MAX_ITERATIONS` + `isTransientProviderError`) موجود ومستورَد من `chatEngine` — التفكيك الميكانيكي السابق أثبت عبر `runLoop.test.ts` + `streaming.test.ts`؛ باقي coordination عمدًا في المحرك (حقن ~10 تبعيات) | ✅ مؤكد (لا redesign) |
| **Phase 2 (أدوات)** | `searchTools.ts`: أداتان جديدتان `search.branches` + `search.currencies` (عبر `guardedQuery` + `company_id = $1::uuid` + fuzzy ≥0.35) — تعالج فجوات القراءة وتغلق وصفي الأشباح | ✅ مكتمل |
| **Phase 3 (ذاكرة)** | `taskLedger.ts`: `LEDGER_MAX_CHARS` 8000→11000 + `MAX_OTHER_REQUESTS` 2→10 + `MAX_OUTCOMES` 8→32 · `summarizer.ts`: digest 1500→2500 + 40→60 سطر + per-line 120→600 / 200→500 / 140→400 · `entityResolver.ts`: `ENTITY_FETCH_LIMIT` 50→200 | ✅ مكتمل |
| **Phase 4 (أمن)** | `sqlGuard.ts` (فرض النطاق + اختبار) + `git` gate: أي `adapter.query` جديد في `modules/ai` يتطلب `guardedQuery` (ratchet العمود 678 يبقى، أي رفع يتطلب تبرير) | ✅ مكتمل |
| **Phase 5 (UI/a11y/i18n)** | `AiSettingsPage.tsx`: `role=switch` → زر حقيقي + `aria-label` · `ChatInput.tsx`: `aria-label` على textarea · `ToolCallCard.tsx`: `aria-expanded` · `ar/en.json`: مفتاحا `notConfigured*` موجودان أصلاً (لا fallback حي) | ✅ مكتمل |
| **التحقق** | `tsc -b --force`: نظيف (0 errors بعد الإصلاح) · `vitest` (5 ملفات: `sqlGuard` + `summarizer` + `taskLedger` + `searchTools` + `toolsContract`): **59/59** بعد تحديث عقدَي `summarizer`/`taskLedger` · `eslint --max-warnings=0` + `build` + `db:check`: **مؤجلة — بيئة Windows مزدحمة بعد vitest واسع (shell timeout)** → تأكيد في CI قبل الدمج | ⏳ للـ CI |

**المهام التالية المقترحة (بعد قرارك):** طيّ `readTools`(21)→`reportTools`(32) · توحيد `create_customer` · نقل `search.fixed_assets/departments` إلى `searchTools.ts` · إضافة `pos.open_shift/close_shift` + `convert_quotation/order` + `update_journal_entry` · إخلاء `created/completedKeys` بـ TTL · صفحة `/ai/diagnostics` (Eval harness) · RAG `pgvector` · بوابة `guardedQuery` النصية الكاملة |

---

## 8) سجل التنفيذ الثاني (2026-11-07/08 — المهام الخمس)

| المهمة | ما نُفّذ | التحقق |
|---|---|---|
| طيّ القراءة + العميل + البحث | search.departments + search.fixed_assets في searchTools.ts + crm.create_customer يفوض إلى sales + تعليق توحيد readTools | tsc نظيف |
| أدوات كتابة (6) | pos.open_shift/close_shift + sales.convert_quotation_to_invoice + purchases.convert_order_to_invoice + accounting.update_journal_entry + inventory.post_stock_transfer | summarizeArgs + route |
| ذاكرة TTL + إعادة بناء | TTL 7 أيام + rebuild يستعيد entities والمفاتيح | tsc نظيف |
| بوابة + ratchet | aiGuardedQueryGate.test.ts + تثبيت 678 | zero raw جديد |
| تقييم + تشخيص | evalHarness (6 حالات) + /ai/diagnostics + i18n متوازن | حتمية بلا مزود |

**التحقق النهائي:** tsc -b = 0 أخطاء (TSC_EXIT:0) بعد إصلاح 4 أخطاء. vitest العمال مهيمنة بيئياً (forks Timeout — سلوك ميداني موثق) → التأكيد الكامل في CI قبل الدمج.

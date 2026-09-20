# AI Module Overview — «مغزى» (Maghz AI Assistant)

> Living doc for the AI Harness (`src/modules/ai/` + `electron/aiHandler.js`).
> Update it when you add a tool family, a channel, a guard, or a phase.
> Enforced facts (tool count, gates) are pinned by tests, not prose.

## 1. What it is

An Arabic-first accounting agent on the **function-calling** pattern. The model
never touches the database: it calls registered tools through one executor
(RBAC + timeouts + audit), and every **write is fail-closed behind a human
confirmation card**. Long jobs run as idempotent batches under **one approval**.

## 2. Module map

| Area | Files | Role |
|---|---|---|
| Loop | `engine/chatEngine.ts` (~2,500 lines, singleton) | send → route → stream → read-now / card-write → resume |
| Claims guard | `engine/claims.ts` (pure) | Detects success-claims with zero executions; AR↔EN evidence bridge |
| Execution gate | `engine/toolExecutor.ts` | Sanitize → RBAC → rate-limit → cache → timeout → audit |
| Router | `engine/toolRouter.ts` (cap 48/cycle) | Always-on core + keyword intent + call-history continuity + adaptive |
| Prompt | `engine/systemPrompt.ts` (~50 rules) | Identity + live company context (VAT/country/calendar) + skills + ledger + memory |
| Memory (session) | `engine/taskLedger.ts` (8k chars) | Full requests + batch outcomes + created entities, outside the 30-msg window |
| Memory (long-term) | `tools/memoryTools.ts` (`ai.remember/recall/forget_fact`) | User-pinned facts on `coreApi` settings (`ai_memory`), auto-injected |
| Batches | `engine/batchQueue.ts` + `batchRunner.ts` + `api/batch*.ts` | DAG (`after_seq` backwards-only), idempotency keys, `{{ref}}` substitution; `ai.preview_batch` dry-runs the whole pipeline (normalize→preflight→RBAC→duplicates→DAG) with a numbered plan and `ready`/`fix-first` verdict |
| Errors | `engine/errorTaxonomy.ts` (22 codes) | Regex-classified → guidance injected for the model, raw never lost |
| Cards | `engine/cardResolvers.ts` | Resolves UUIDs to human names on approval cards (fire-and-forget) |
| Input hygiene | `engine/argNormalizers.ts`, `engine/dialectMap.ts` | Indic digits/thousands/currency, Hijri+Grep dates, 14 dialect families |
| Direction | `engine/docDirection.ts` + `tools/directionTools.ts` | Ours/external/ambiguous invoice classifier (fail-ASK) |
| Media | `attachments/*` + `engine/llmParts.ts` | Layered extraction, base64 never in Postgres, latest-turn-only wiring |
| Usage | `engine/usageMeter.ts` | Per-send/session token meter; warn 80%, honest stop 100% |
| Providers | `api/providers.ts` | One preset table (hosts, models, name rules); fail-fast 404 hints; B3 failover plan (transient-only, pre-chunk) |
| Key vault | `api/keyVault.ts` | Browser AES-GCM device vault (`enc:v1:`), kill-switch, revocation |
| SQL guard | `security/sqlGuard.ts` | SELECT-only + table allow-list + no `;`/comments |
| Search | `tools/searchTools.ts` | Token-aware Arabic fuzzy search per entity |
| Writes (8 domains) | `tools/writeTools/{sales,purchases,accounting,inventory,crm,hr,manufacturing,settings}.ts` | Server-truth math (VAT/discount/units), never model arithmetic |
| Compound flows | `tools/wizardTools.ts`, `tools/hrTools.ts`, `tools/taxTools.ts`, `tools/posTools.ts`, `tools/fixedAssetTools.ts` | Atomic or compensating sequences |
| Diagnostics | `tools/diagnosticTools.ts` | `posting_blockers` / `unbalanced_entries` — prove, don't guess |
| Skills (12) | `skills/*` | Injected prompt blocks (accounting, CRM, units, tax, regional fluency…) |
| UI | `components/{AiChatPage,ChatPanel,ChatInput,MessageBubble,ToolCallCard,BatchProgressCard,…}` | Optimistic bubbles, stop button, progress cards, session drawer |
| Main process | `electron/aiHandler.js` (~20 `ai:*` channels) | Keys (safeStorage), streaming, sessions, batches, rate limits |
| Browser twin | `api/browserBridge.ts` | Same surface on PGlite + direct provider fetch |

## 3. Non-negotiable contracts

1. **No SQL from the model** — tools call module APIs; the only SQL path is
   `guardedQuery` (allow-listed SELECT).
2. **Fail-closed writes** — unknown tool names default to the write path.
3. **`company_id` from session, never from the LLM** — on every statement.
4. **Approval cards show substance** — every write defines `summarizeArgs`.
5. **Claimed success needs executed writes** — the fabrication guard deletes
   the rest and forces a real call or an honest admission.
6. **Untrusted data rides fenced** — attachments (`BEGIN_ATTACHMENT`) and DB
   payloads (`BEGIN_UNTRUSTED_DATA`); `notes` are data, never instructions.
7. **VAT is read, never assumed** — unknown rate = 0 + ask the user.
8. **Local dates only** — `localToday()`; `toISOString()` is banned for "today".

## 4. CI gates (all must stay green)

`toolsContract` (permissions/naming/cards) · `schemaDrift` (real columns) ·
`sqlNumbering` ($N ↔ params) · `providerDefaults` (main↔bridge parity) ·
`preloadParity` (cjs↔js↔e2e-stub) · `aiGuards` (rate limit, purge, VAT-null).

## 5. Verification ladder (this machine)

Vitest workers are environmentally dead here (60s spawn timeout, both pools).
Proven fallback, in order: `tsc -b` → `eslint --max-warnings=0` → in-process
esbuild-bundle checks of the real sources (`C:\Users\AbuEmad\AppData\Local\Temp\opencode\verify-phaseA\`)
→ `vite build` → Playwright (works) → full `vitest` in CI.

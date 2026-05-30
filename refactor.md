# OwnPilot — Refactor & Improvement Report

**Date:** 2026-05-30 (revised — some items reflect pre-2026-05-23 snapshot; see §14 for corrections)
**Scope:** Full monorepo audit — `packages/{core,gateway,ui,cli}` + `website/`
**Version baseline:** v0.5.1

---

## 1. Executive Summary

OwnPilot is a **privacy-first personal AI assistant platform** built as a TypeScript monorepo of **~108 K lines** across **1 223 source files** and **564+ test files** (26 500+ passing tests). The codebase is in healthy shape: recent work (2026-05-23) consolidated the autonomous agent layer (Fleet/Subagent/Orchestra removed → Claw/Soul/Crew), promoted 9 horizontal capabilities into a unified `RuntimeContext` bundle, migrated all runtimes to the capability accessor pattern, and eliminated nearly all `TODO/FIXME/HACK` markers.

The primary remaining risks are **scale fatigue** — not architectural flaws:

1. Several gateway files exceed 800 lines and need decomposition along domain seams (confirmed: 15 files >800 LoC).
2. 20 services still use the legacy `let instance: X | null` singleton pattern — NONE are registered in ServiceRegistry.
3. Request validation is inconsistent — only ~12 explicit Zod uses across 80+ route files; most handlers parse JSON without runtime validation.
4. 30+ files carry explicit "circular dependency workaround" comments; `dynamic import()` proliferation obscures the dependency graph.
5. No OpenTelemetry observability layer; only an internal `tracing` ALS context.
6. Discord/Slack/Matrix channel plugins are **ACTIVE** — not removed. The ambiguity was a documentation error.
7. 3+ tests fail or flake under full-suite concurrency due to module-singleton state pollution.

None of these are emergencies. Each is a candidate for a focused refactor PR. The document is organized into priority tiers aligned with a recommended sequencing plan.

---

## 2. Repository Health at a Glance

| Metric                                  | Value                                             | Notes                                                      |
| --------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| Version                                 | **v0.5.1**                                        | pnpm workspace, Turborepo 2.x                              |
| Total TS/TSX lines                      | **~108 K**                                        | Source + tests across 4 packages                           |
| Source files                            | **~1 223**                                        | Excluding tests/dist/generated                             |
| Test files                              | **564+**                                          | 26 500+ passing tests; strong 46% test-to-source ratio     |
| services/claw/manager.ts (1 839 LoC)    | Over budget                                       |
| `TODO`/`FIXME`/`HACK` in production     | **4** (all in docs/code prompts)                  | Almost fully eliminated from code                          |
| `as any` (production)                   | **5** (all intentional, eslint-disable-commented) | Excellent                                                  |
| `@ts-ignore`/`@ts-expect-error`         | **1**                                             | Excellent                                                  |
| Silent `.catch(() => {})`               | **46**                                            | UI fire-and-forget; 1–2 in gateway (risk)                  |
| `console.*` (production)                | **107**                                           | 82 in `core/agent/debug.ts` (legitimate); 19 UI; 6 gateway |
| ESLint warnings                         | **417 (gateway) / 60 (core) / 0 (ui) / 0 (cli)**  | Almost entirely `no-explicit-any` in `*.test.ts` files     |
| Migrations (idempotent)                 | **34+**                                           | All use `IF NOT EXISTS` / `IF EXISTS` pattern              |
| Legacy singletons (`let instance: X`)   | **27+**                                           | Should adopt `ServiceRegistry` uniformly                   |
| Dynamic `await import()` calls          | **344**                                           | Reflects circular-dep workarounds                          |
| Files with circular workaround comments | **30+**                                           | Codified in comments                                       |
| Failing tests under full concurrency    | **4 / 26 500+**                                   | 3 known-flaky (singleton pollution); 1 new                 |

### Per-Package Size

| Package   | Source LoC | Test LoC | Test Files         | Key Risk                          |
| --------- | ---------- | -------- | ------------------ | --------------------------------- |
| `gateway` | ~83 K      | ~66 K    | 403 test files     | God files, singletons, validation |
| `core`    | ~37 K      | ~34 K    | 138 test files     | Clean (zero external deps)        |
| `ui`      | ~68 K      | small    | 141 Playwright e2e | Large pages, fire-and-forget      |
| `cli`     | ~5 K       | full     | Simple surface     | Minimal                           |
| `website` | small      | none     | Landing page       | Low risk                          |

### Tech Stack

- **Runtime:** Node.js 22+, pnpm 10+
- **Language:** TypeScript 5.9
- **Server:** Hono 4.x (`packages/gateway/src/app.ts`)
- **Frontend:** React 19, Vite 7, Tailwind CSS 4
- **Testing:** Vitest 4.x across all packages (549 test files)
- **Build:** Turborepo 2.x
- **Linting:** ESLint 10 (flat config), Prettier
- **Database:** PostgreSQL via `pg` adapter, 84 repository files

### Architecture — Claw/Soul/Crew (2026-05-23)

The autonomous agent layer was simplified:

```
Agent (base) → Claw (unified runtime) → Soul/Crew/Heartbeat (persistent team identity)
```

Fleet, Subagent, Orchestra removed. Claw handles concurrent cycles + subclaw spawn. Workflow `parallelNode` handles DAG parallelism. Crew `delegate_task` handles agent-to-agent handoff.

The **Two-Layer Capability Architecture** defines clean boundaries:

- **Layer 2 (vertical):** Chat, Claw, Soul Heartbeat, AgentRunner, Workflow, Coding Agents, Pulse, Triggers
- **Layer 1 (horizontal):** LLMRouter, ChannelService, ConfigCenter, EventSystem, PermissionGate, MemoryService, AuditService

---

## 3. Top-Priority Refactors (P0)

### 3.1 Decompose God Files (>800 LoC)

15 files exceed 800 LoC. `manager.ts` is the most critical — it is well-structured with clear section comments, but its 1 839-line `ClawManager` class is too large to test in isolation.

| File                                   | LoC   | Suggested Split                                                                                                                                                                                                                                                                  |
| -------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/claw/manager.ts`             | 1 839 | Extract task-plan methods (`replacePlan`, `updateTaskOnSession`, `splitTaskOnSession`) into `claw-task-plan.ts`; escalation methods into `claw-escalation.ts`; scheduling helpers into `claw-scheduling.ts`. NOTE: `claw-tools.ts` no longer exists — tools split in 2026-05-23. |
| `ws/server.ts`                         | 1 353 | Extract login/throttle, channel routing, heartbeat, per-event handlers.                                                                                                                                                                                                          |
| `routes/claws.ts`                      | 1 291 | Pull each route group into `routes/claws/` sub-routes.                                                                                                                                                                                                                           |
| `server.ts`                            | 1 194 | See §3.2 — boot decomposition is the primary goal, not line count.                                                                                                                                                                                                               |
| `services/agent/service.ts`            | 1 189 | Split lifecycle methods from query/display methods.                                                                                                                                                                                                                              |
| `routes/chat/index.ts`                 | 1 019 | Extract history, streaming, fetch-url into separate route modules.                                                                                                                                                                                                               |
| `db/repositories/claws.ts`             | 969   | Extract query helpers from mutation methods.                                                                                                                                                                                                                                     |
| `services/browser-service.ts`          | 917   | Split by domain: screenshot, PDF, browser automation.                                                                                                                                                                                                                            |
| `services/claw/runner.ts`              | 895   | Runner is already a separate class — consider extracting cycle phases.                                                                                                                                                                                                           |
| `tools/claw/definitions.ts`            | 853   | Already well-structured — just above threshold.                                                                                                                                                                                                                                  |
| `tools/claw/lifecycle-executors.ts`    | 853   | Split `install_package`, `run_script`, `create_tool`, `execute` into separate files.                                                                                                                                                                                             |
| `tools/claw/plan-executors.ts`         | 841   | Already focused on plan operations — just above threshold.                                                                                                                                                                                                                       |
| `tools/claw/output-executors.ts`       | 841   | Already focused on output operations — just above threshold.                                                                                                                                                                                                                     |
| `middleware/schemas/workflow-claws.ts` | 839   | Split by domain into `schemas/agents.ts`, `schemas/workflows.ts`, etc.                                                                                                                                                                                                           |
| `tools/browser-tools.ts`               | 823   | Extract screenshot/PDF/markdown tool groups.                                                                                                                                                                                                                                     |

**Acceptance Criteria:** no production file >800 LoC except dense data tables.

> **Note on claw tools:** `claw-tools.ts` (1 852 LoC) no longer exists. The autonomous agent layer was restructured on 2026-05-23. Tools are now in `tools/claw/` with domain-specific files (lifecycle-executors, delegation-executors, output-executors, context-executors, plan-executors, skill-executors, management-tools, sandbox-env, validation).

### 3.2 Unify Singleton Management on `ServiceRegistry` (REVISED)

`packages/core/src/services/registry.ts` defines a typed `ServiceToken`-based DI container. Gateway `server.ts` registers ~14 services through it, but **27+** services in `packages/gateway/src/services/` still use the legacy `let instance: X | null` pattern.

Sample offenders:

- `artifact-service.ts`, `browser-service.ts`, `claw-manager.ts`, `claw-service.ts`,
- `cli-tool-service.ts`, `coding-agent-service.ts`, `coding-agent-sessions.ts`,
- `custom-data-service.ts`, `edge-mqtt-client.ts`, `edge-service.ts`,
- `embedding-queue.ts`, `embedding-service.ts`, `extension-sandbox.ts`,
- `agent-registry.ts`, `custom-tool-registry.ts` …

**Problems caused by mixed patterns:**

- Tests cannot reliably reset state — no `resetSingleton()` helpers. Root cause of 3 known-flaky tests.
- Boot ordering becomes opaque — `server.ts` is **841+ LoC** with **69** initialize/import lines.
- `await import()` workarounds proliferate because order matters when singletons live at module scope.

**Plan:**

1. Promote every `let instance` to `register(Services.X, …)` at the proper boot stage in `server.ts`.
2. Add missing `Services.X` tokens to `core/src/services/registry.ts`.
3. Replace ad-hoc `getX()` call sites with `getServiceRegistry().get(Services.X)`.
4. Add `registry.reset()` per-test cleanup.
5. Document boot order in `docs/SERVICE_CATALOG.md`.

### 3.3 Standardize Request Validation

Current reality:

- `packages/gateway/src/middleware/validation.ts` defines **dozens of Zod schemas** but they are ONLY used in select routes (~12 explicit `Schema.parse` calls vs **79** raw `await c.req.json()` invocations).
- Routes that parse JSON without validation: `agent-command-center.ts`, `claws.ts`, `mcp.ts`, `personal-data.ts`, `fleet.ts`, `edge.ts`, `bridges.ts`, `costs.ts`, `crews.ts`, `notifications.ts` … — the most security-sensitive surface.

**Plan:**

1. Adopt `@hono/zod-validator` or wrap existing schemas in a `validateBody(schema)` middleware that 400s on failure with `apiError`.
2. Define one schema per route in `<route>-schemas.ts` next to the route file.
3. Enforce via a custom ESLint rule that flags `await c.req.json()` inside a `routes/*.ts` unless wrapped in `validateBody`.
4. Generate OpenAPI from schemas — eliminates `docs/API_ROUTES.md` drift.

### 3.4 Replace Circular-Import Workarounds with Explicit Layering

**30+** files have comments like `Lazy-imported to break circular dependency` and **344** `await import()` calls overall.

Specific cases:

- `routes/agents.ts` ↔ `ws/server.ts` (lazy import in WS)
- `routes/custom-tools.ts` ↔ `services/custom-tool-registry.ts`
- `services/conversation-service.ts` ↔ `assistant/chat-post-processor.ts`
- `routes/chat.ts` ↔ `routes/chat-state.ts`
- `plans/executor.ts`, `routes/webhooks.ts`, `routes/mcp.ts`, `services/cli-chat-provider.ts`, `services/mcp-server-service.ts`

**Plan:**

1. Introduce a strict layering rule: `routes/` → `services/` → `db/repositories/` → `core/`. No upward imports.
2. Add `dependency-cruiser` to CI with rules forbidding upward layer crossings and the `await import(./relative)` workaround.
3. Move dynamic imports of optional packages into a single `lazy-deps.ts` barrel.

### 3.5 Fix Failing/Flaky Tests Under Full-Suite Concurrency

```
FAIL  src/services/agent-runner-utils.test.ts  > uses openai provider type for non-native providers
FAIL  src/services/cli-chat-provider.test.ts   > streams ToolBridge progress across rounds for gemini
FAIL  src/services/subagent-runner.test.ts     > uses non-native provider type as "openai"
FAIL  src/routes/database/operations.test.ts   > GET /db/stats > returns detailed stats when connected
```

The first three are documented as "passes in isolation, hangs under concurrency" — suspected module-singleton pollution from `registry.reset()` being absent. **See §3.2** resolves these by design.

The `routes/database/operations.test.ts` failure is new — investigate.

---

## 4. Architecture-Level Improvements (P1)

### 4.1 Adopt OpenTelemetry for End-to-End Tracing

The current `packages/gateway/src/tracing/index.ts` is a custom in-process trace context, not exported. There is no OTel, no Sentry, no Prometheus exporter.

Recommendation: keep internal trace types (domain-flavored — `tool_call`, `memory_recall`, `autonomy_check`) but emit them as OTel spans via `@opentelemetry/sdk-node`. Auto-instrument Postgres, HTTP, Hono. Bridge `pino` logs to OTel (already used). Self-hosted users can ignore OTel; ops users wire any backend.

### 4.2 Resolve Discord/Slack Channel Plugin Ambiguity

`MEMORY.md` says "Channels: Telegram + WhatsApp (Baileys). Discord/Slack/LINE/Matrix removed."
But `packages/gateway/package.json` still lists `@slack/socket-mode`, `@slack/web-api`, `discord.js`, and `packages/gateway/src/channels/plugins/{discord,slack,matrix}/` still contain code.

Either:

1. Genuinely retire those plugins (drop deps — `discord.js` alone is ~50 transitive packages — and delete folders), or
2. Update `MEMORY.md` to reflect active status.

This is the largest **memory ↔ code drift** in the project. Address in a single 1-day PR.

### 4.3 Audit Silent `.catch(() => {})`

46 instances — most in UI fire-and-forget. The dangerous ones live in the gateway:

- `services/agent-runner-utils.ts:456` — `getProviderMetricsRepository().record(metricInput).catch(() => {})` swallows persistence errors silently. Should log at `warn`.

Triage rule: every silent catch should either (a) `log.warn('…', err)`, (b) replace with a `void` operator + comment, or (c) be handled at a higher level.

### 4.4 Consolidate `resolveProviderAndModel` Family

CLAUDE.md documents two variants: simple (`settings.ts`) vs full waterfall (`agent-runner-utils.ts`). Is the simple variant ever the right answer when the full waterfall exists? A single canonical resolver with a `{ strict: boolean }` flag would remove divergence risk.

### 4.5 Replace MD5 in Tool Templates

`routes/tool-templates.ts` advertises `md5` and `sha1` as defaults. Both are broken; default should be `sha256`. Same in `core/src/sandbox/context.ts` — `md5` exposed in the sandbox should be deprecated with a warning.

### 4.6 `getAdapterSync()` Removal

`packages/gateway/src/db/adapters/index.ts` exposes `getAdapterSync()` for "backwards compatibility." Grep call sites and migrate them; sync DB access in an async Node.js runtime is a foot-gun (initialization races).

### 4.7 Console.\* in Agent Debug Layer

82 of the 107 production `console.*` calls live in `core/src/agent/debug.ts` and render formatted boxes with `─`/`═` characters. Pipe these through `getLog('AgentDebug')` with a custom `debug-trace` level. Benefits: respect log levels, work in non-TTY contexts (Docker, CI), enable redaction.

---

## 5. UI Refactors (P1)

### 5.1 Page-Component Decomposition

12 pages exceed 1 000 LoC. Standard split pattern: `Page → SectionContainer → Card → Field`.

Pages to split first:

- `ChatPage.tsx` (1 299) — extract `MessageList`, `Composer`, `ToolbarBar`, `ScrollManager`.
- `McpServersPage.tsx` (1 328), `CodingAgentsPage.tsx` (1 362).
- `SystemPage.tsx` (1 212), `ProfilePage.tsx` (1 219), `LogsPage.tsx` (1 185), `TriggersPage.tsx` (1 096), `PlansPage.tsx` (1 066).

### 5.2 Centralize Fire-and-Forget Pattern

13+ `.catch(() => {})` in hooks/components are latent bugs. Provide a small helper:

```typescript
export const ignore = <T>(p: Promise<T>, label = 'ignored') =>
  p.catch((err) => log.warn(label, { error: err }));
```

Require its use. ESLint rule flags bare `.catch(() => {})`.

### 5.3 Component Memo Audit

262 of 327 `*.tsx` files do NOT use `React.memo`, `useMemo`, or `useCallback`. Most are correct for leaf components, but large list components and charts in `AnalyticsPage` would benefit from profiling.

---

## 6. Data Layer (P2)

### 6.1 Repository Consolidation

`BaseRepository` (`db/repositories/base.ts`) provides `query/queryOne/execute/exec/transaction/now/boolean`. Good. But:

- **84 repositories** is a lot — several can merge (`pomodoro` + `habits` + `goals` form one "productivity" repo; `model-configs` + `local-providers` overlap).
- Transaction usage is rare — only 2 production call sites. Many multi-statement flows that should be atomic likely aren't.
- The largest repos (workflows: 960 LoC, memories: 952, plans: 921, claws: 899) carry domain logic that belongs in matching `services/`. Repos should be CRUD-only.

### 6.2 Test Migrations Against PostgreSQL 16 in CI

CI should run migrations 001–034 against `pgvector/pgvector:pg16` on every PR to catch ordering or idempotency regressions. The pattern is documented in `CLAUDE.md` but not wired into `.github/workflows/ci.yml`.

### 6.3 Index Review with `EXPLAIN ANALYZE`

Migration 027 (`performance_indexes.sql`) was added April 2026. Run `EXPLAIN ANALYZE` pass against realistic data — particularly:

- `chat_history (chat_id, created_at DESC)` — interaction with `claw_history` truncation.
- `workflow_executions (status) WHERE status IN ('running', 'paused')` — partial indexes are fragile across PG upgrades.

---

## 7. Security & Privacy (P1)

### 7.1 CSP and Security Headers Audit

`app.ts` uses `secureHeaders()` from Hono. Audit the actual emitted CSP — long-running interactive UI + eval'd workflow code nodes means a clean CSP is hard. Document what is loosened and why.

### 7.2 Workflow Code-Node Sandbox

The workflow `node-executor`s run user-controlled JS via `node:vm`. The note `MAX_ARRAY_EVAL_SIZE = 10_000`, `MAX_EXPRESSION_LENGTH = 10_000`, and `validateToolCode` exist — good. But `vm.runInContext` is not a security boundary. Confirm all entry points run in actual sandbox. The external audit (2026-05-07) concluded Worker+vm with blacklist validation is correct for Node.js 22. Real defense-in-depth requires OS-level isolation (Docker `--read-only --network=none --cap-drop=ALL`).

### 7.3 SSRF Coverage Audit

The `packages/gateway/src/utils/ssrf.ts` helper exists and is used by workflow node-executor. Audit every other outbound HTTP call: `browser-service`, channel webhooks, `http-request` node, Composio callbacks.

### 7.4 Default PostgreSQL Credentials Warning

`docker-compose.yml` and `.env.example` document `POSTGRES_PASSWORD=ownpilot_secret` as the default. Add a pre-flight check in `server.ts` that warns when the default is detected in `NODE_ENV=production`.

### 7.5 Extension Sandbox Permission Bypass (Critical)

**`SandboxExecutionOptions.grantedPermissions` is accepted but never forwarded into the worker.** `utils.callTool()` from extension code can invoke any of 250+ tools (including `shell_exec`, `write_file`, `send_email`) regardless of user-approved permissions.

The fix: forward `grantedPermissions` + `ownerUserId` through `workerData` payload in `extension-sandbox.ts`. In the worker, persist these on startup and expose a read-only accessor. In `tool-executor.ts` `setupSandboxCallToolHandler`, look up `grantedPermissions` and gate with `checkPermission(toolName, `grantedPermissions`)`. Replace `userId: 'system'` with the extension's `ownerUserId`. Emit `audit.extension.callTool` event with `{ extensionId, toolName, userId, allowed, reason }`.

---

## 8. Tooling & DX (P2)

### 8.1 ESLint Test-File Override

417 warnings in gateway are almost entirely `@typescript-eslint/no-explicit-any` in test files. Add an `overrides` block in `eslint.config.js` allowing `any` in `*.test.ts` files so production warnings stay visible.

### 8.2 Vitest Concurrency Triage

The 3 flaky tests are concurrency-related (module singletons). Once §3.2 lands (`registry.reset()` per test), lower `vitest.config.ts` pool concurrency if cost is acceptable, or run flagged tests in a serial pool.

### 8.3 Type-Only Imports

`tsconfig.base.json` has `verbatimModuleSyntax: true` — good. Add `eslint-plugin-import` with `consistent-type-imports` to catch missing `import type`. Helps tree-shaking and faster builds.

### 8.4 Bundle Analysis for UI

`packages/ui` lazy-loads 64 pages. Add `rollup-plugin-visualizer` to `vite.config.ts` and gate PRs on bundle-size diff.

### 8.5 Pre-Commit Hook

`husky` is installed but `.husky/` directory is present. Wire `lint-staged` for fast `prettier` + `eslint --fix` on staged files.

---

## 9. Documentation & Memory Drift (P2)

`docs/` contains 25+ markdown files. Several show drift:

- `dead-code-audit-report.md` (April 2026) is ~5 weeks stale and contradicts `MEMORY.md` re: Discord/Slack plugins.
- `architecture.md` (dated 2026-05-28) is recent — verify it reflects the post-Claw runtime layout (Fleet/Subagent/Orchestra removed in 2026-05-23).
- `ADR/` directory exists but not referenced from `CLAUDE.md` — add a section.

`CHANGELOG.md` is well-maintained. Keep it.

---

## 10. Recommended Refactor Sequencing

| Wave                      | PRs                                                                                                                                                                   | Risk   | Effort           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------- |
| **1. Quick wins**         | (a) ESLint test-file override<br>(b) Replace gateway `console.*` with `getLog`<br>(c) Audit silent `.catch(() => {})` in gateway<br>(d) Add CI migration test vs pg16 | Low    | 1–2 days each    |
| **2. Service registry**   | Migrate `let instance` in groups of 4–5 per PR; add `registry.reset()` in tests                                                                                       | Medium | 2–3 weeks        |
| **3. Validation rollout** | `validateBody` middleware + one PR per route domain (agents, chat, workflows, …)                                                                                      | Low    | 1 PR per domain  |
| **4. God-file splits**    | One PR per file in §3.1, smallest first                                                                                                                               | Low    | 1–2 days each    |
| **5. Layering/circular**  | Add `dependency-cruiser`, fix violations in groups                                                                                                                    | Medium | 1 week + ongoing |
| **6. Memory ↔ code sync** | Decide Discord/Slack fate; update `MEMORY.md`                                                                                                                         | Low    | 1 day            |
| **7. OTel adoption**      | Span emission shim + auto-instrumentation                                                                                                                             | Medium | 1 week           |
| **8. UI page splits**     | Tackle 12 large pages incrementally                                                                                                                                   | Low    | 1 PR per page    |
| **9. Extension sandbox**  | Forward `grantedPermissions` userId through sandbox tool bridge                                                                                                       | Medium | 1 day            |

---

## 11. What is NOT Recommended

- **Don't replace `pg` with an ORM.** The repository pattern + raw SQL is fast, explicit, and the team owns it.
- **Don't merge `core` and `gateway`.** Core's zero-dependency boundary is genuinely valuable for plugin authors and tests.
- **Don't migrate Hono → Fastify/Express.** Hono is fast, edge-ready, and ~1 900 `apiResponse`/`apiError` call sites are tied to it.
- **Don't switch test runners.** Vitest 4.x is current and 26 K+ tests is a sunk cost worth keeping.
- **Don't introduce a state-management library in UI.** Zustand-flavored stores + React Query patterns are sufficient.
- **Don't adopt wasmtime for sandboxing without more research.** The external audit (2026-05-07) concluded Worker+vm + wasmtime/QuickJS has practical issues. The current Worker+vm approach is correct for Node.js 22 with the adversarial test suite.

---

## 12. OpenTelemetry Gaps (Notable)

The following subsystems emit no structured spans today:

- `ToolExecutor.executeTool()` — no parent span for tool calls
- `BaseRepository.query()` — no DB query spans
- `AgentRunner.executeCycle()` / `SoulHeartbeatService.run()` — no agent cycle spans
- `WorkflowService.dispatchNode()` — node-level spans missing
- WebSocket message handlers

Adding OTel instrumentation to these would complete the observability picture.

---

## 13. Key Files Quick Reference

| File                                                            | Purpose                                      | Priority  |
| --------------------------------------------------------------- | -------------------------------------------- | --------- | -------------------- | --------- |
| `packages/gateway/src/server.ts`                                | 1 194 LoC, boot orchestration, 69 boot lines | P0 §3.2   |
| `packages/gateway/src/app.ts`                                   | Hono middleware + route registration         | reference |
| `packages/gateway/src/services/claw/manager.ts`                 | 1 839 LoC, Claw lifecycle manager            | P0 §3.1   | + route registration | reference |
| `packages/gateway/src/tools/claw-tools.ts`                      | 1 852 LoC god file                           | P0 §3.1   |
| `packages/gateway/src/middleware/validation.ts`                 | 1 243 LoC, Zod schemas                       | P0 §3.3   |
| `packages/gateway/src/services/workflow/node-executors.ts`      | 1 694 LoC                                    | P0 §3.1   |
| `packages/gateway/src/services/workflow/workflow-service.ts`    | 1 549 LoC                                    | P0 §3.1   |
| `packages/gateway/src/ws/server.ts`                             | 1 427 LoC WS + auth                          | P0 §3.1   |
| `packages/ui/src/components/ToolPicker.tsx`                     | 1 247 LoC                                    | P0 §3.1   |
| `packages/ui/src/components/MarkdownContent.tsx`                | 1 416 LoC                                    | P0 §3.1   |
| `packages/core/src/plugins/isolation.ts`                        | 1 177 LoC                                    | P0 §3.1   |
| `packages/gateway/src/services/extension/sandbox.ts`            | Extension permission bypass                  | P1 §7.5   |
| `packages/gateway/src/utils/ssrf.ts`                            | SSRF guard                                   | P1 §7.3   |
| `packages/gateway/src/services/agent-runner-utils.ts`           | `.catch(() => {})` at line 456               | P1 §4.3   |
| `packages/gateway/src/channels/plugins/{discord,slack,matrix}/` | Ambiguous status                             | P1 §4.2   |
| `packages/core/src/agent/debug.ts`                              | 82 `console.*` calls                         | P2 §4.7   |

---

## 14. Post-Audit Corrections (2026-05-30)

This section records facts confirmed by fresh inspection vs. the original audit that this report was based on. Items in the original report that are **confirmed already implemented** or **based on outdated snapshots** are noted here.

### Already Implemented

| Item                                       | Original Claim                               | Actual State                                                                                                                                                                                                                                                        |
| ------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESLint test-file override (§8.1)           | Not present; needed                          | **Already present** in root `eslint.config.js` lines 62–72. `no-explicit-any` is `off` for all `*.test.ts` / `*.spec.ts` / `test-helpers.ts` files. 417 gateway warnings should be near zero.                                                                       |
| Extension sandbox permission bypass (§7.5) | `grantedPermissions` not forwarded           | **Already fixed.** `workerData` includes `ownerUserId` + `grantedPermissions` (sandbox.ts line 317). `setupSandboxCallToolHandler` gates with `checkPermission()` and emits `audit.extension.callTool` events.                                                      |
| `.catch(() => {})` in runner-utils (§4.3)  | Silent swallow at line 456                   | **Already fixed.** Line 731–735 uses `log.warn('Failed to record provider metrics', { error: err })`. Remaining `.catch(() => {})` in runner-utils (lines 432, 567, 635) are documented "race-loser suppression" — intentional design.                              |
| CI migration smoke test (§6.2)             | Missing                                      | **Already present** as `migration-smoke-test (pgvector/pg16)` job in `.github/workflows/ci.yml` lines 81–128.                                                                                                                                                       |
| Pre-commit hook (§8.5)                     | `.husky/pre-commit` missing                  | **Already present** at `.husky/pre-commit` with `pnpm exec lint-staged`.                                                                                                                                                                                            |
| Claw tools split                           | `claw-tools.ts` at 1 852 LoC needs splitting | **Already split** (2026-05-23). Tools live in `tools/claw/` as domain-specific files: `lifecycle-executors`, `delegation-executors`, `output-executors`, `context-executors`, `plan-executors`, `skill-executors`, `management-tools`, `sandbox-env`, `validation`. |

### Incorrect Original Claims

| Item                 | Original Claim                                             | Corrected Fact                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §3.1 god file list   | Listed `claw-tools.ts`, `workflow/node-executors.ts`, etc. | Files don't exist or have been split. See §3.1 revised table for actual files.                                                                                   |
| §3.2 singleton count | "27+" services, ~14 registered                             | **20** services use legacy pattern; **zero** are registered in ServiceRegistry. Some have tokens but aren't wired.                                               |
| §4.2 Discord/Slack   | "still wired but flagged as removed in memory notes"       | **Active and wired.** `plugins/init.ts` registers all three. Real SDK packages in `package.json`. No deprecation marker.                                         |
| §7.5 Sandbox bypass  | Critical unfixed issue                                     | **Already fixed** — see "Already Implemented" above.                                                                                                             |
| MEMORY.md drift      | "MEMORY.md says Discord/Slack removed"                     | **No `MEMORY.md` at project root.** `docs/MEMORY_AND_GOALS.md` covers memory/goal systems only. The ambiguity is a documentation error, not a code/memory drift. |
| §8.1 ESLint override | Missing                                                    | **Already present** — see "Already Implemented" above.                                                                                                           |

### Actual Remaining Issues (Prioritized)

1. **20 legacy singletons** — none in ServiceRegistry. Root cause of flaky tests under concurrency. Risk: `pulse.ts` (bg timers), `coding-agent/service.ts` (session manager), `embedding/queue.ts` (event subscriptions).
2. **`services/claw/manager.ts` at 1 839 LoC** — well-structured but too large to unit test in isolation. Natural seams: task-plan methods, escalation methods, scheduling helpers.
3. **15 files >800 LoC** in gateway — see §3.1 revised table.
4. **Request validation** — only ~12 explicit Zod `parse()` calls vs 79 raw `await c.req.json()`.
5. **`server.ts` at 1 194 LoC** — boot orchestration needs decomposition (related to singleton migration).

### What NOT to Do (Unchanged from Original)

- Don't replace `pg` with an ORM.
- Don't merge `core` and `gateway`.
- Don't migrate Hono → Fastify/Express.
- Don't switch test runners.
- Don't introduce UI state management library.
- Don't adopt wasmtime for sandboxing without more research.

---

_End of report._

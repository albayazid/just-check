# Testing Strategy

This document is the source of truth for how the `oearol-lumy` codebase is
tested. It explains the tooling choices, the coverage targets, the file-by-file
exclusion rationale, and the incremental batch plan for bringing coverage from
0% to a meaningful ~80%.

It is referenced from [`vitest.config.ts`](../vitest.config.ts) and
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

---

## 1. Goal

Bring a production Next.js 16 app (auth, payments, AI, database) from **0%
test coverage** to a **meaningful ~80%** — where "meaningful" means the
coverage number reflects real behaviour assertions, not lines that merely
executed.

**Non-goal:** literal 100% coverage. The last ~15–20% lives in generated UI
(shadcn/Radix wrappers), type declarations, and error fallback branches whose
tests would assert nothing useful and rot fast.

---

## 2. Tooling

| Tool | Role | Why this one |
|------|------|--------------|
| **Vitest 4** + `@vitejs/plugin-react` | Unit + component test runner | Native ESM, fast, Vite-powered. Jest has ESM pain on Next 15+/React 19. |
| **jsdom** | DOM environment for component tests | More compatible than `happy-dom` with Next server-component APIs. |
| **@testing-library/react** + `jest-dom` + `user-event` | Component behaviour testing | Industry standard; tests behaviour, not implementation. |
| **@testing-library/dom** | Peer dep of RTL | Must be installed explicitly (RTL declares it as a peer). |
| **msw** (Mock Service Worker) | `fetch` interception for hooks/components | Real request interception, not monkey-patching. Wired in Batch D. |
| **@vitest/coverage-v8** | Coverage | V8-native, no source instrumentation, fastest option. |
| **Playwright** | End-to-end browser tests | Separate runner; only the 5–8 critical user journeys. Wired in Batch I. |


---

## 3. Project layout

```
vitest.config.ts            # unit + component config (jsdom env)
playwright.config.ts        # E2E config (builds + starts the app)
src/test/
  setup.ts                  # jest-dom matchers + jsdom polyfills + per-test cleanup
  factories.ts              # test data builders (buildFolder, ...)
  mocks/                    # service mock factories — added per-batch as needed
  fixtures/                 # binary test files — added per-batch as needed
src/lib/**/*.test.ts        # co-located unit tests
src/components/**/*.test.tsx
e2e/                        # Playwright specs (Batch I)
.github/workflows/ci.yml    # lint + typecheck + test + coverage
```

**Conventions:**
- Tests are **co-located** with source (`foo.ts` ↔ `foo.test.ts`). Easier to
  keep in sync than a parallel `tests/` tree.
- `globals: false` — `describe`/`it`/`expect`/`vi` are **imported explicitly**
  from `vitest` in every test file. More portable, clearer at a glance. (Forgetting
  the `vi` import is the easy mistake — the file fails with `ReferenceError: vi
  is not defined`.)
- `env: { TZ: "UTC" }` is pinned in `vitest.config.ts` for the whole suite.
  Several modules (`age-validation`, `web-search/time-range`) read the clock via
  **local-TZ** accessors (`getDate`/`getMonth`/`getFullYear`/`setHours`), and the
  time-aware tests anchor `vi.setSystemTime()` to UTC instants. Without `TZ=UTC`
  the local calendar date of those instants shifts by host timezone, so tests
  pass on CI (UTC by default) but fail on dev machines in other TZs. Date-only
  ISO strings like `"2000-06-29"` also parse as UTC per the ES spec, which is
  only deterministic under a pinned TZ. Do not remove this line.
- **AAA pattern** (Arrange-Act-Assert), one behaviour per test, behaviour-named
  describes (`describe('calculateCost', () => it('charges premium models at 2x', …))`).
- **No snapshot tests** except for stable generated output.
- **Hermetic tests** — `clearMocks`/`restoreMocks` are on globally; `cleanup()`
  runs after every test.
- **Mock factories in `src/test/mocks/`** — reusable builders for external
  services. Each batch that needs a new service mock adds it here.
  - `supabase.ts` — `createMockSupabaseClient({ rpc, tables })` returns a
    chainable client. `tables` accepts a single result (returned for every
    query) or an array (sequential per query on that table). Chains are
    memoized per table so call history accumulates. `getInsertedRow(client,
    table)` extracts insert args with the cast centralised.
  - `clerk.ts` — `setAuthenticated(auth, id)` / `setUnauthenticated(auth)`.
  - `ratelimit.ts` — `rateLimitModuleMock()` (all 25 limiters) +
    `rateLimitAllowed()` / `rateLimitBlocked()` cast helpers (the real
    `RatelimitResponse` type carries extra fields routes don't read).
  - `dodo.ts` — `dodoModuleMock()` constants + `dodoResponse(body, init)` for
    `fetch` stubs.
  - `env.ts` — `stubDodoProductEnvs(vi)`.
  - `stubs/server-only.ts` — empty module aliased to `server-only` in
    `vitest.config.ts` so `*.server.ts` imports don't throw under jsdom.
- **`vi.mock` factory gotcha** — `restoreMocks: true` wipes any implementation
  set inside a `vi.mock(...)` factory. Put bare `vi.fn()` in factories and
  configure implementations in `beforeEach`. Only `auth`/`supabase` survive
  because they're re-set per-test anyway.
- **Vitest mock typing gotcha** — `vi.mock` replaces runtime but TypeScript
  still type-checks against the real module's types. Helpers like
  `rateLimitAllowed()` return `never` to slip past strict signatures
  (`RatelimitResponse`, etc.).

---

## 4. Coverage configuration

Provider: `v8`. Reporters: `text`, `text-summary`, `html`, `lcov`,
`json-summary`. Output: `./coverage`.

**Thresholds are NOT enforced yet.** They will be added to `vitest.config.ts`
and gated in CI once overall coverage crosses the target. Enforcing now (with
~1% coverage from the Batch A proof-of-harness) would make every PR fail.

Target once enforced: `lines 80 / functions 75 / branches 70 / statements 80`.

---

## 5. Coverage exclusions and why

These are excluded from the coverage denominator because they are either not
meaningfully unit-testable or not ours to test:

| Path | Reason |
|------|--------|
| `node_modules/**`, `.next/**`, `coverage/**`, `public/**`, `e2e/**` | Build artifacts / dependencies / assets |
| `src/test/**` | Test infrastructure itself |
| `src/types/**` | Pure TypeScript interface declarations |
| `src/providers/**` | React Query provider boilerplate |
| `src/stores/**` | Zustand store is a one-line wrapper |
| `src/components/ui/**` | Generated shadcn/Radix wrappers — tested upstream by Radix |
| `src/components/icons/**` | Static SVG components |
| `src/components/theme-provider.tsx` | 9-line `next-themes` wrapper |
| `src/lib/ratelimit.ts` | Upstash client instantiation — integration-only |
| `src/app/**/page.tsx`, `layout.tsx` | Thin shells that delegate to feature components |
| `src/app/**/error.tsx`, `not-found.tsx`, `global-error.tsx`, `loading.tsx` | Next.js error/loading boundaries |
| `**/*.config.{ts,mts,mjs,js}` | Build configs |
| `**/next-env.d.ts` | Auto-generated |
| `**/*.test.{ts,tsx}`, `**/*.spec.{ts,tsx}` | Tests themselves |

After exclusions the effective denominator is ~22,000 LOC.
80% ≈ ~17,600 lines meaningfully covered.

---

## 6. Incremental batch plan

Coverage is brought up in reviewable batches. Each batch is independently green
(tests pass, no regression) before the next starts. Paused for human review at
every batch boundary.

| Batch | Scope | Approx tests | Status |
|-------|-------|--------------|--------|
| **A. Foundation** | Tooling, configs, `src/test/` skeleton, CI, 2 proof-of-harness tests | 36 | ✅ done |
| **B. Pure logic** | All pure lib code: `age-validation`, `uuid-utils`, `allowance/{calculations,pricing}`, `models/router`, `modes`, `system-prompt/builder`, `web-search/{time-range,favicon-utils}`, `storage/attachment-url-utils`, `subscription-utils`, `password-validation` | 171 (207 total) | ✅ done |
| **C1. Billing infra + allowance + subscription routes** | Mock infrastructure (`src/test/mocks/`: supabase chain, clerk, ratelimit, dodo, env), `subscription-utils.server` constants, `allowance/{service,tool-charging,token-usage-log}`, 5 `api/subscription/*` routes | 95 (302 total) | ✅ done |
| **C2. Dodo webhook** | `app/api/webhooks/dodo` + `buildSubscriptionData` extraction (separate veto-able diff) + signature/idempotency/state-machine tests + 3 deliberate-quirk regression pins | 43 (345 total) | ✅ done |
| **D. Chat core** | `app/api/chat/route.ts` (+ helper extraction), `lib/validation/validate-chat-messages`, `lib/conversation-history/*`, `lib/chat-history/*` | ~60–80 | pending |
| **E. Storage & sharing** | `lib/storage/*`, `lib/sharing/share-service`, `app/api/share/*`, `app/api/upload` | ~50–70 | pending |
| **F. Remaining API routes** | ~25 CRUD routes (conversations, folders, profile, feedback, memory, onboarding) | ~80–100 | pending |
| **G. Feature components** | `chat-input`, `sidebar`, message renderers, dialogs — via RTL, no snapshots | ~60–90 | pending |
| **H. Hooks** | Top 8 hooks via `renderHook` + msw | ~30–40 | pending |
| **I. E2E (Playwright)** | login → onboarding → chat → upload → checkout → share | ~8 | pending |

### Coverage tracking (honest project-wide denominator)

Coverage uses `provider: "v8"` with `include: ["src/**/*.{ts,tsx}"]` so the
reported % covers every source file (after exclusions), not just the ones tests
happened to import. Target: `lines 80 / functions 75 / branches 70 / statements 80`.

| Batch | Statements | Branches | Functions | Lines |
|-------|-----------:|---------:|----------:|------:|
| A | ~0.5% | ~0.5% | ~0.7% | ~0.5% |
| B | 2.81% (198/7027) | 2.66% (134/5024) | 2.47% (36/1452) | 2.85% (191/6696) |
| C1 | 6.31% (444/7027) | 6.32% (318/5024) | 3.99% (58/1452) | 6.51% (436/6696) |
| **C2 (current)** | **8.29% (583/7030)** | **7.52% (378/5022)** | **4.54% (66/1453)** | **8.58% (575/6699)** |

The denominator (~7027 statements after exclusions) is smaller than the raw
~22k LOC estimate because v8 counts executable statements, not lines, and the
exclusions (shadcn UI, type files, page shells, etc.) remove a lot of inert
code. Target 80% ≈ ~5620 statements covered.

After Batch B lands, the coverage threshold in `vitest.config.ts` gets a first
non-zero value and is ratcheted upward with every subsequent batch.

---

## 7. Refactoring policy

Some production files (notably `app/api/chat/route.ts` ~567 LOC and
`app/api/webhooks/dodo/route.ts` ~690 LOC) are too large to test as monoliths.
To reach the coverage target, pure helpers will be **extracted** from these
files and tested independently.

**Policy:** every extraction is shown to the reviewer as a **separate diff**
for veto before it lands. No production behaviour change is bundled into a
"tests" commit. The extraction is a refactor that must preserve behaviour; the
tests prove it does.

---

## 8. Known pre-existing issues (flagged, not fixed by testing work)

- **`npm run lint` fails on `main`** with 71 errors + 77 warnings, almost all
  `@typescript-eslint/no-explicit-any` in `src/lib/web-search/providers/*` and
  `src/lib/website-content/providers/*`. This predates the testing work. In CI,
  lint runs as `continue-on-error: true` until this debt is cleaned up. Fixing
  it is a separate task for the user to approve.

- **`npm run typecheck` fails on `main`** with 51 TS7016 errors, all from a
  single root cause: `lucide-react@1.20.0` declares
  `typings: dist/lucide-react.d.ts` in its package.json but ships **no `.d.ts`
  files**, so every file importing `lucide-react` fails with
  *"Could not find a declaration file for module 'lucide-react'"*. This predates
  the testing work — `lucide-react@^1.20.0` was already in `package.json`. The
  project masks these errors in production via
  `next.config.ts` `typescript: { ignoreBuildErrors: true }` (the stale TODO
  noted below). In CI, typecheck runs as `continue-on-error: true` until the
  lucide-react types are fixed.
  - Note: `lucide-react@1.20.0` is a suspicious version — the upstream
    `lucide-react` package maxes at ~0.4xx. This may be a fork, proxy, or
    typosquat. Worth a separate investigation when fixing the types.
  - Candidate fix (separate, user-approved change): either correct the
    `lucide-react` version, or add a local `src/types/lucide-react.d.ts`
    ambient module declaration. The latter makes lucide imports `any`, losing
    icon-name type safety — acceptable as a stopgap, not as a permanent state.

- **`next.config.ts` has `typescript: { ignoreBuildErrors: true }`** with a TODO
  comment. `tsc --noEmit` does NOT pass clean (see above), so this flag is
  actively masking real type errors, not stale caution. It should be removed
  only after the lucide-react types are fixed and `tsc --noEmit` is green.

### Verification footgun: `incremental: true` + `tsconfig.tsbuildinfo`
`tsconfig.json` has `"incremental": true`, so `tsc --noEmit` writes and reuses a
`tsconfig.tsbuildinfo` cache. A stale cache can report **bogus "exit 0"** for
errors that a fresh check would surface — which is exactly how the lucide-react
breakage above was missed during local verification in earlier batches while CI
(`npm ci`, no cache) caught it.

**Rule for verifying typecheck locally:** delete `tsconfig.tsbuildinfo` before
running `npm run typecheck`, or run `npx tsc --noEmit --incremental false`. The
file is gitignored (`*.tsbuildinfo`) so it never reaches CI, but it pollutes
local verification. Never report "typecheck passes" based on an incremental run.

### Codebase observation: `get_user_subscription` RPC shape inconsistency

 surfaced while writing Batch C tests. The same Supabase RPC is consumed two
different ways:

- `lib/allowance/service.ts:56` (`getUserPlanId`): `data?.plan_id ?? 'free'` —
  reads it as a **single object**.
- `app/api/subscription/*/route.ts`: `Array.isArray(data) ? data[0] : data` —
  handles **either** shape.

If the real `get_user_subscription` Postgres function returns an array (SETOF),
then `data?.plan_id` is `undefined` on an array, so `getUserPlanId` always
returns `'free'` — meaning every user would be billed at the free allowance
regardless of their actual plan. This is either (a) masked because the RPC
returns a single row in production, or (b) a latent billing bug. Worth
verifying the RPC's return type against the database definition. Tests in
`allowance/service.test.ts` mock the rpc as a single object to match what
`getUserPlanId` expects; route tests mock it as an array to match what the
routes expect.

# Migration Changelog — April 2026

Summary of the migration from a zero-build three-file app (`index.html` + `app.js` + `app.css`) to a TypeScript + Vite project with tests, CI, and Netlify auto-deploy. Plus the follow-up fixes + features shipped the same session.

Live site: https://a-packrat.netlify.app

---

## PR #1 · Migrate to TypeScript + Vite with tests, CI, and Netlify deploy [merged]

Foundational migration. Zero runtime behavior changes — same Firestore data model, same features, same security rules. Modernizes the foundation so everything else has typecheck, tests, and CI gates to build on.

**Build + tooling**
- TypeScript with `"strict": true` + `noUncheckedIndexedAccess`
- Vite 8 replacing the zero-build CDN setup
- Firebase SDK bundled from npm (`firebase@10.11.1`, pinned to match prior CDN version) — tree-shaken to ~40% of SDK surface
- Env-var-driven config via `VITE_FIREBASE_*` + startup guard that throws a clear error when any required var is missing
- ESLint flat config with `typescript-eslint` + Prettier (100 cols, single quotes)

**Module split (14 source modules, ~2,900 LOC)**
- `firebase.ts` — env-var-driven init
- `store.ts` — in-memory Maps + Firestore path helpers + onSnapshot listeners
- `router.ts` — pure stack/title/URL helpers (no DOM)
- `photos.ts` — resize, upload, lazy load, pending-photo state, picker wiring
- `constants.ts` — CATEGORIES taxonomy, icons, AI model/URL
- `csv.ts` — RFC 4180 parser
- `weather.ts` — geocode + historical climate aggregation
- `ai.ts` — Anthropic prompt building + response parsing
- `utils.ts` — typed `$` / `$maybe` DOM helpers with a `FormEl` union type, `esc`, `sortOrderMidpoint`
- `ui/{toast,confirm,sheet}.ts` — reusable UI primitives
- `types.ts` — data-model interfaces mirroring `docs/design.md § 2.3`
- `main.ts` — auth, view rendering, event delegation, DOM glue

**URL routing (pushState)**
- URL scheme: `/`, `/items`, `/lists`, `/trip`, `/settings`, `/login`, `/containers/:id`, `/items/:id`, `/lists/:id`
- `popstate` listener handles browser back/forward
- Initial pathname captured before first render for deep-link support on reload
- SPA redirect in `netlify.toml` so direct URL hits don't 404

**Tests**
- **130 Vitest unit tests** across 6 files (csv, utils, weather, ai, constants, router)
- Fetch mocks for `geocode` / `fetchTripWeather` / `callAI`
- Constants-integrity tests catch taxonomy drift
- **12 Cypress E2E** smoke tests on the login UI (no auth required)

**CI/CD**
- `.github/workflows/ci.yml` on every PR + push to main: lint → prettier → typecheck → tests → build → Cypress
- Cypress screenshots uploaded as artifacts on failure
- Netlify handles production deploy via GitHub App integration

**Dev experience**
- Makefile wraps npm scripts (`dev`, `build`, `test`, `e2e`, `deploy`)
- Claude Code PostToolUse hook auto-formats + typechecks every edit (`.claude/settings.json` + `.claude/hooks/format-and-typecheck.sh`)

**Latent bugs caught during migration**
- `initializeApp(firebaseConfig)` was called twice
- `parseAIResponse` fence-stripping regex only matched the `json`-language variant, missed plain ```` ``` ```` fences

---

## PR #2 · Hide chrome on /login, redirect authed users [merged]

**Bug:** logged-in users reaching `/login` (via URL bar, bookmark, or browser back) saw the login card with the app header + bottom-nav still visible on top of it — `z-index: 200` chrome rendered over the `z-index: 10` login view.

**Root cause:** chrome visibility was only toggled in `onAuthStateChanged`, never in `showView`. Once auth resolved, chrome stayed in that state until the next auth transition.

**Fix:**
- `showView` now owns chrome visibility, tied to view name (`login` → hidden, everything else → visible)
- Guard: if called with `name: 'login'` while `store.user` is set, redirect to `'containers'` with `replaceState` so URL matches
- Removed redundant chrome-toggling from `onAuthStateChanged`

**Tests:** +2 Cypress scenarios (deep-link to `/login` keeps chrome hidden; protected URL + logged out redirects to login).

---

## PR #3 · Visually-hidden file inputs so iOS camera capture works [merged]

**Bug:** tapping the Camera button on iOS opened the photo library instead of the camera.

**Root cause:** iOS Safari ignores `capture="environment"` when the file input is hidden via `display:none` and triggered programmatically with `.click()`. The input has to be in the layout tree for iOS's media-capture path to honor the attribute.

**Fix:** swap `display:none` for a visually-hidden CSS class (1×1 px, `opacity: 0`, `pointer-events: none`, still laid out). Applied to all three file inputs (`file-camera`, `file-library`, `file-csv`).

---

## PR #4 · Desktop webcam capture via getUserMedia [merged]

Desktop users with a webcam now get an in-browser capture UI when they tap Camera, instead of a file picker.

**Platform routing** in `triggerPhotoPicker`:
- Touch device (`matchMedia('(pointer: coarse)').matches`) → file input + `capture="environment"` (native camera app — richer UX than a `<video>` element)
- Desktop + `getUserMedia` available → full-screen webcam modal
- Permission denied or unsupported → fall back to OS file picker

**Capture flow:** `getUserMedia({ video: { facingMode: { ideal: 'environment' } } })` → modal with live `<video>` + snap button + cancel → snap draws to canvas → `canvas.toBlob('image/jpeg', 0.92)` → `File` named `camera-<timestamp>.jpg` → same photoPickerCallback path the file inputs use. Tracks stopped on close so the camera indicator light turns off promptly.

---

## PR #5 · Category dropdown mismatch on first render [merged]

**Bug:** opening the New Item form showed `Group = Clothing` but `Category = only "other"`. Toggling groups and back populated it correctly.

**Root cause:** `valOpts` in `itemFormBody` fell back to `'misc'` when the item had no stored group. But the Group `<select>` had no `selected` option, so the browser defaulted to the *first* `<option>` (Clothing). Mismatch on first render. Same thing happened for legacy items with unknown group names.

**Fix:** align `valOpts`'s fallback to the first `CATEGORIES` key (matching the browser's first-option default).

---

## PR #6 · Subtype emojis + group-by toggle on Items view [merged]

**Per-subtype emojis**
- New `SUBCATEGORY_ICONS` map keyed by `"group/value"` (30+ icons)
- `iconForCategory(group, value)` helper prefers subtype icon, falls back to group icon
- Examples: `clothing/shoes → 👟`, `gear/diving → 🤿`, `documents/passport → 🛂`
- Used in item rows, item-detail no-photo placeholder, item-form photo preview default

**Group-by segmented control**
- Segmented control above item list: `Group by [Category] [Container]`
- Doesn't touch filters — search, container dropdown, and category chips still apply
- Persisted to `localStorage` (`packrat_items_grouping`)
- Category mode: groups in `CATEGORIES` key order
- Container mode: alphabetical by name, Unassigned last

---

## PR #7 · Reactive trip planner with multi-month + live climate [this PR]

Rewrite around progressive disclosure. No submit button — results update as the user fills in inputs.

**Multi-month picker** (replaces single `<select>`)
- Tap chips to pick any combination
- Human labels: single month `"May"`, contiguous range `"June–August"`, non-contiguous `"Feb, May, Oct"`

**Year-round climate strip**
- Destination resolves → one API call fetches full year daily climate → per-month aggregates
- 12-month bar chart below the destination input (avg high/low per month)
- Cells are tappable — double as a secondary month picker
- Summary at top reflects current selection, falls back to year-round when nothing's picked

**Reactive data flow**
- Destination (debounced 500 ms) → `geocode` → `fetchYearClimate` → render
- Month tap → re-aggregate + re-render → schedule AI update
- Duration / notes (debounced 500 ms) → schedule AI update
- Activities / candidates → schedule AI update (candidates debounced 500 ms)
- `maybeCallAI` checks prereqs (location + ≥1 month + duration + ≥1 candidate + API key); shows a helpful bullet list of missing fields when unmet

**Cancellation**
- `AbortController` on in-flight geocode / climate / AI calls — rapid input changes abort prior fetches
- Generation counter on AI calls as a second guard against stale renders
- `callAI` now accepts an optional `AbortSignal`

**Bugs caught along the way**
- Checkbox checkmarks were invisible: the global input reset applied `appearance: none` to *all* inputs, including `type="checkbox"`. Scoped the reset to exclude checkbox/radio.
- Activity buttons weren't wired up: they rendered and toggled visually but never mutated `tripActivities`, so the AI prompt never saw activity info.

**Tests:** +8 unit tests for `aggregateMonths` (contiguous label, non-contiguous wrap-around, sparse nulls, etc.).

---

## Infrastructure + ops decisions

**Netlify linkage** — the existing `a-packrat` site was CLI-only with no Git integration (`repo_url: null`, `provider: null`). Pushes to `main` did nothing on Netlify. Linked via the Netlify dashboard (Settings → Build & deploy → Continuous deployment → Link repository → GitHub → obartra/packrat → `main`). Manual CLI deploys (`make deploy`) still work.

**Firebase env vars — "secret" flag** — all six `VITE_FIREBASE_*` vars were initially marked `is_secret: true` in Netlify, which masks values with asterisks in the `production` / `deploy-preview` / `branch-deploy` contexts (only `dev` keeps the real value). Vite baked those asterisks into the bundle and Firebase Auth rejected them. Fix: `is_secret: false` via `netlify env:unset` + `netlify env:set` (the API doesn't allow downgrading a var from secret). Firebase web config is designed to be public (protected by Firestore/Storage security rules, not secrecy) — `is_secret` is the wrong flag for these.

**Branch protection on `main`**
- Required status checks: `Cypress E2E` + `Lint / typecheck / unit tests / build`
- Strict mode (branches must be up-to-date before merging)
- PRs required, 0 reviews (solo-dev friendly, CI-gated)
- Force push + deletions blocked
- Admins not enforced (owner can override in emergencies)

---

## Open follow-ups

- **`main.ts` size**: ~1,900 lines of view rendering + event delegation. Next refactor: extract view modules one at a time (containers, items, lists, trip, settings), each with a small rendering test.
- **Authenticated E2E coverage**: requires a test Firebase project. The current 12 Cypress tests cover the login-shell UI only.
- **Bundle splitting**: Firebase SDK is ~123 kB gzipped. Lazy-loading Firestore-only views vs. Storage-only flows would trim per-page cost, but 123 kB is acceptable for v1.
- **`firebase.ts` eager init**: throws at module-evaluation time when env vars are missing. If any test needs to import a firebase-adjacent module without real env vars, this'll need a lazy getter (`getFirebase()`). Not currently blocking.

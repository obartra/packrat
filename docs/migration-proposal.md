# Migration Proposal: Packrat → TypeScript + Vite + Vitest

Moving from the current three-file vanilla JS setup to a proper TypeScript project with a build pipeline, unit tests, split source files, and environment-based configuration.

---

## Target repo layout

```
packrat/
├── index.html                   # stays at root (Vite SPA convention)
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .env.example                 # committed template
├── .env.local                   # gitignored, real values
├── netlify.toml
├── Makefile                     # thin wrapper over npm scripts
├── src/
│   ├── main.ts                  # entry: CSS import, auth bootstrap, wire events
│   ├── firebase.ts              # app/auth/db/storage init from env vars
│   ├── store.ts                 # in-memory Maps + loadAllData
│   ├── router.ts                # showView + history.pushState
│   ├── types.ts                 # Container, Item, List, ListEntry, Category…
│   ├── constants.ts             # CATEGORIES taxonomy, container types
│   ├── utils.ts                 # escHtml, sortOrder midpoint, formatters
│   ├── photos.ts                # picker, canvas resize, upload, lazy loader
│   ├── csv.ts                   # RFC 4180 parser + batch import
│   ├── weather.ts               # geocode + archive fetch + daily aggregation
│   ├── ai.ts                    # Anthropic prompt build + fetch + JSON validate
│   ├── ui/
│   │   ├── sheet.ts             # slide-up form panel
│   │   ├── toast.ts
│   │   └── confirm.ts
│   ├── views/
│   │   ├── login.ts
│   │   ├── containers.ts        # list + form
│   │   ├── container-detail.ts
│   │   ├── items.ts             # list + form
│   │   ├── item-detail.ts
│   │   ├── lists.ts
│   │   ├── list-detail.ts
│   │   ├── trip.ts
│   │   └── settings.ts
│   ├── styles/
│   │   ├── tokens.css           # CSS custom properties
│   │   ├── base.css             # reset, body, typography
│   │   ├── components.css       # buttons, cards, chips, fab, sheet
│   │   └── views.css            # per-view layout
│   └── __tests__/
│       ├── csv.test.ts
│       ├── utils.test.ts
│       ├── weather.test.ts
│       ├── ai.test.ts
│       └── router.test.ts
├── docs/
│   ├── design.md
│   └── migration-proposal.md
├── CLAUDE.md                    # already exists — updated incrementally per phase
├── README.md
└── dist/                        # vite output, gitignored
```

The section banners already in `app.js` (`// === CONTAINERS — render list`, etc.) map nearly 1:1 to these modules, so the split is mechanical.

---

## Key decisions (with tradeoffs)

| Decision | Recommendation | Why |
|---|---|---|
| Output filenames | **Hashed** (Vite default: `dist/assets/index-a1b2c3.js`) | Best-practice cache-busting. `index.html` references them automatically. Output is still a flat `dist/` of static assets deployable to Netlify identically. If fixed `app.js`/`app.css` are required instead, rollup output can be configured, but you lose cache-busting. |
| Firebase SDK source | **npm + bundle, pinned to `firebase@10.11.1`** | Matches the CDN version currently in use — no accidental major upgrade mid-migration. Get tree-shaking (the app uses ~40% of the SDK surface), offline dev, and version control. Upgrade to latest as a separate, isolated PR after migration stabilizes. |
| TS strictness | **`"strict": true`** from day one | Easier to stay strict than to retrofit. DOM queries need casts — solved with a tiny `$<T>(id)` helper. |
| Test runner | **Vitest** + `jsdom` | Vite-native, zero config beyond the vite plugin. Same API as Jest. |
| Env vars | **`VITE_FIREBASE_*` prefix, wired from the first `firebase.ts` extraction** | Vite only exposes `VITE_`-prefixed vars to client code. Wiring env vars during the initial module extraction (Phase 4) avoids touching `firebase.ts` twice. Firebase config is already public (protected by security rules), but env vars enable clean dev/staging/prod separation. |
| CSS split | **4 files: tokens / base / components / views, done in Phase 2** | Splitting during the verbatim file move costs almost nothing and makes view-module extraction in Phase 4 cleaner (each view knows what it owns). Deferring it would mean a pure-CSS-risk PR later during TS migration stress. Vite bundles them into one CSS file anyway. |
| `index.html` location | **Stays at repo root** | Vite's SPA convention. Change: `<script src="app.js">` → `<script src="/src/main.ts">`, drop the `<link rel="stylesheet">` (CSS imported from `main.ts`). |
| SPA routing on Netlify | **Add redirect rule to `netlify.toml`** | The router uses `history.pushState`, so direct URL hits on non-root paths would 404 without a `/* → /index.html` rewrite. Include the rule unless the router is confirmed to never change the URL path. |

---

## Phased execution (each phase independently shippable)

### Phase 1 — Scaffolding, no code changes yet
- `npm init -y`
- Install: `vite typescript @types/node vitest jsdom @vitest/ui firebase@10.11.1`
- Create `tsconfig.json` (strict, ESNext, DOM libs, `moduleResolution: bundler`, `verbatimModuleSyntax: true`)
- Create `vite.config.ts` with vitest plugin config (jsdom env, `src/__tests__/**/*.test.ts`)
- `package.json` scripts: `dev`, `build`, `preview`, `test`, `test:ui`, `typecheck`
- `.gitignore` += `node_modules/`, `.env.local`, `.env.*.local`, `coverage/`
- `.env.example` with all `VITE_FIREBASE_*` keys (empty values)

**Checkpoint:** `npm run dev` runs Vite (no app yet).

### Phase 2 — Verbatim move + Firebase npm swap + CSS split
- `app.js` → `src/main.js`
- `app.css` split into `src/styles/{tokens,base,components,views}.css` (mechanical split by section)
- In `src/main.js`: swap Firebase CDN imports for npm imports (one-line replacement per import); add `import './styles/tokens.css'` etc. at top
- In `index.html`: update script src to `/src/main.js`, remove `<link rel="stylesheet">`

**Why swap Firebase now:** without it, `npm run build` produces a `dist/` with external runtime CDN dependencies — the build pipeline isn't actually validated. Swapping here gets tree-shaking from day one and a single PR touches CDN→npm once.

**Checkpoint:** `npm run dev` runs the full app with zero behavior changes. `npm run build` produces `dist/` with no external runtime dependencies.

### Phase 3 — Rename to .ts, add types
- `src/main.js` → `src/main.ts`
- Create `src/types.ts` with interfaces matching `docs/design.md § 2.3`
- Add `$<T extends HTMLElement>(id: string): T` helper in `utils.ts` (extracted first)
- Work through typecheck errors progressively:
  - DOM casts for every `getElementById` call
  - `Map<string, Container>`, `Map<string, Item>` etc. generics on the store
  - `serverTimestamp()` return type (`FieldValue`) in doc write paths
  - Typed event delegation handlers in the bottom event section

**Checkpoint:** `npm run typecheck` clean, app still runs identically.

### Phase 4 — Split into modules (including env-var-aware `firebase.ts`)
Order matters (leaves first, roots last):
1. `constants.ts`, `types.ts`, `utils.ts` (zero deps)
2. `firebase.ts` — extract init code, **read config from `import.meta.env.VITE_FIREBASE_*` in this same step**, add startup guard that throws a clear error listing any missing required var
3. `store.ts` (the `store` Maps, `loadAllData`, `photoUrlCache`)
4. UI primitives: `ui/sheet.ts`, `ui/toast.ts`, `ui/confirm.ts`
5. `router.ts`, `photos.ts`, `csv.ts`, `weather.ts`, `ai.ts`
6. `views/*.ts` one at a time — each view is independently extractable
7. `main.ts` shrinks to: CSS imports + `onAuthStateChanged` + view wiring

Each module extraction is an atomic commit/PR and testable in isolation.

**Netlify dashboard step:** after this phase ships, set all six `VITE_FIREBASE_*` values in site settings → env vars, then redeploy. `.env.local` handles local dev.

### Phase 5 — Unit tests
Priority (pure functions, no Firebase):
- `csv.test.ts` — parser handles quoted fields, embedded commas, CRLF, blank rows, missing columns
- `utils.test.ts` — sortOrder midpoint, escHtml, date helpers
- `weather.test.ts` — daily aggregation from sample archive API response
- `ai.test.ts` — prompt serialization, JSON response validation, itemId filtering against a mock store
- `router.test.ts` — `showView(name)` toggles correct `.view` elements, history state transitions, back-navigation integrity

Skip: Firebase-touching code, DOM-rendering view modules. Mocking Firebase is high-effort, low-value for v1.

Coverage target: ~80% on pure-function modules, 0% on views is fine.

### Phase 6 — Tooling + docs
**`netlify.toml`**:
```toml
[build]
  publish = "dist"
  command = "npm run build"
[build.environment]
  NODE_VERSION = "20"
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```
(Drop the redirect block only if the router is confirmed to never change the URL path.)

**`Makefile`** becomes a thin wrapper:
```makefile
dev:      ; npm run dev
build:    ; npm run build
test:     ; npm run test
typecheck:; npm run typecheck
deploy:   ; npm run build && netlify deploy --prod --dir dist
```
Drop `DEPLOY_FILES` — Vite handles it.

---

## Doc updates

**`docs/design.md`** — update § 3.1 "File Structure" and the "no build toolchain" constraint in § 1. Add a subsection noting: Firebase SDK is now bundled via npm; env vars drive config; TypeScript types live in `src/types.ts` and mirror the data model in § 2.3.

**`README.md`** — replace "Zero dependencies. No build step." with:
- Install: `npm install`
- Dev: `npm run dev` (or `make dev`)
- Test: `npm run test`
- Build: `npm run build`
- Env setup: copy `.env.example` → `.env.local`, fill in Firebase config

**`CLAUDE.md`** — already exists (created via `/init`). Update incrementally per phase rather than waiting for the end:
- **After Phase 2:** remove "three-file vanilla JS" and "no build toolchain" claims; remove `DEPLOY_FILES` reference
- **After Phase 4:** add module boundaries, `src/types.ts` as the type-level source of truth, env var setup
- **After Phase 5:** add test + typecheck commands
- **Keep throughout (still load-bearing):** in-memory `store` Maps pattern, lazy photo loading, mobile input constraints, security rules anchor on uid

---

## Suggested PR sequence

| PR | Phases | Risk |
|---|---|---|
| 1 | 1 + 2 | Medium — no behavior change, but file moves + build tooling + Firebase CDN→npm swap + CSS split all land together |
| 2 | 3 | Medium — 1,800 lines of DOM-heavy JS with Firestore generics, typed event delegation, and `FieldValue` return types is a real conversion |
| 3 | 4 | Medium — split into ~20 modules; do as several sub-PRs per module group (leaves, then firebase/store, then UI, then views) |
| 4 | 5 | Low — pure-function tests, no production code changes |
| 5 | 6 | Medium — touches Netlify config (env vars + SPA redirect); verify prod deploy and at least one deep-link URL after merge |

---

## Summary of revisions from v1

- **Firebase npm swap moved from Phase 4 → Phase 2** so `dist/` validates the full build pipeline from day one
- **Env vars moved from Phase 7 → Phase 4** alongside `firebase.ts` extraction (no double-touch)
- **CSS split moved from optional Phase 5 → Phase 2** to keep it out of TS-migration risk and make view extraction cleaner
- **Phase 3 (TS conversion) reclassified Low → Medium**
- **`netlify.toml` gains SPA redirect rule** for `history.pushState` URLs
- **`router.test.ts` added** to Phase 5 targets
- **`firebase@10.11.1` pinned** to match current CDN version — avoids accidental upgrade
- **CLAUDE.md updates spread across phases** rather than bulked at the end (file already exists)
- **8 phases compressed to 6**

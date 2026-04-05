# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```
make install          # npm install
make dev              # vite dev server on :5173
make build            # tsc --noEmit && vite build → dist/
make test             # vitest run (single pass, unit tests)
make typecheck        # tsc --noEmit (app + cypress)
npm run lint          # eslint
npm run lint:fix      # eslint --fix
npm run format        # prettier --write
npm run format:check  # prettier --check (what CI runs)
npm run e2e           # cypress run (boots dev server via start-server-and-test)
npm run e2e:open      # cypress open (interactive)
make deploy           # local manual deploy to Netlify
```

Single test file: `npx vitest run src/__tests__/csv.test.ts`
Watch mode: `npm run test:watch`

## CI + Deploy

`.github/workflows/ci.yml` runs on every PR + push to main:
- `checks` job: lint, prettier, typecheck, unit tests, build
- `e2e` job: Cypress against a live dev server, uploads screenshots on failure

Both jobs need `VITE_FIREBASE_*` secrets because `src/firebase.ts` throws at startup when env vars are missing. See `docs/ci-deploy.md` for the full list and how to configure them.

**Netlify auto-deploys `main`** via its native GitHub integration (configured in the Netlify dashboard, not via `netlify deploy` in CI). PRs get deploy previews automatically. The `netlify.toml` at repo root pins `command = "npm run build"`, `publish = "dist"`, Node 20, and the SPA redirect.

## Architecture

**TypeScript + Vite SPA** with Firebase backend, bundled for static deployment to Netlify. `index.html` at the repo root is the Vite entry; it references `/src/main.ts` which imports the CSS modules and wires up auth + views.

### Sources of truth

- **`docs/design.md`** — canonical architecture spec. Data model, Firestore security rules, feature specs, AI prompt schema. Read before any non-trivial change.
- **`src/types.ts`** — TypeScript interfaces for the data model (Container, Item, List, ListEntry, etc.) that mirror `docs/design.md § 2.3`.
- **`src/main.ts`** — application entry and most of the view logic (containers, items, lists, trip, settings, CSV import, event delegation). Navigate via `// ===` section banners.

### Extracted modules (testable, no Firebase)

- `src/csv.ts` — RFC 4180 parser
- `src/weather.ts` — Open-Meteo geocode + historical-climate aggregation
- `src/ai.ts` — Anthropic prompt building, response parsing, itemId filtering
- `src/utils.ts` — `$` / `$maybe` DOM helpers, `esc`, `sortOrderMidpoint`, `FormEl` type
- `src/constants.ts` — CATEGORIES taxonomy, icons, AI model/URL

These have unit tests in `src/__tests__/` and should stay free of Firebase/DOM dependencies. Tests mock by calling the pure functions directly.

### Firebase + env vars

`src/firebase.ts` initializes Firebase from `import.meta.env.VITE_FIREBASE_*` and throws at startup if any required var is missing. Local dev uses `.env.local` (gitignored); production uses Netlify dashboard env vars. The Firebase config is public (protected by the Firestore/Storage security rules in `docs/design.md § 2.5`) but env vars enable clean dev/staging/prod separation.

### State pattern (load-bearing)

All user data lives under `users/{uid}/...` in Firestore. Security rules anchor on `request.auth.uid == uid`, so there's no server-side code — the client talks directly to Firestore/Storage.

After login, `loadAllData()` bulk-loads all containers, items, lists, and list entries into module-level `store` Maps in `main.ts`. Subsequent reads, filters, search, sort, and cross-references (e.g. "which lists contain this item?") operate entirely in memory. **Do not introduce per-row Firestore queries on list render.** `onSnapshot` is used only for `containers` and `lists` (small, frequently shared); items and entries are updated locally after writes.

Photos are stored in Firebase Storage as paths (never URLs) on the doc. `getDownloadURL()` is called lazily via `IntersectionObserver` when a thumbnail enters the viewport, and cached in `photoUrlCache` for the session.

### DOM helper pattern

`$<T>(id)` in `utils.ts` returns `FormEl` by default — a union of `HTMLElement` with optional props from `HTMLInputElement`/`HTMLSelectElement`/`HTMLTextAreaElement`/`HTMLButtonElement`. This lets `.value`, `.disabled`, `.checked` etc. be accessed without casts at call sites. The tradeoff is that those props come through as optional (`string | undefined`), which matches the app's defensive `?.value ?? ''` style.

### Routing

Single-page app. `showView(name, params)` in `main.ts` toggles one `.view` div at a time and calls `history.pushState` to sync the URL. `src/router.ts` owns the pure logic: `ViewName` union, title resolution, view-stack manipulation, and `urlToRoute`/`routeToUrl` for URL↔view mapping. URLs follow: `/` (containers), `/items`, `/lists`, `/trip`, `/settings`, `/containers/:id`, `/items/:id`, `/lists/:id`, `/login`. A `popstate` listener handles browser back/forward. On initial load, the app captures `window.location.pathname` before render so deep-links survive (`netlify.toml` has the SPA redirect so non-root paths serve `index.html`).

### Secrets

- **Firebase config** lives in `.env.local` (gitignored) and Netlify dashboard env vars. See `.env.example` for required keys.
- **Anthropic API key** is BYO per device: entered in Settings, stored in `localStorage` under `packrat_anthropic_key`, never written to Firestore. AI calls go browser-direct to `api.anthropic.com`.

### Mobile-first constraints that affect code changes

- Text inputs must be `font-size: 16px` minimum (iOS auto-zooms smaller inputs on focus).
- No `contenteditable` — edits use styled `<input>`, `<select>`, `<textarea>`.
- Forms live in the slide-up "sheet" panel (`#sheet` in `index.html`) rather than separate views — the sheet is reused across flows by setting its title/body/save handler via `openSheet(title, bodyHTML, onSave)`.

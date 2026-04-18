# CI and deployment setup

Packrat uses:

- **GitHub Actions** for PR checks (lint, typecheck, tests, build, Cypress E2E)
- **Netlify** for production hosting, auto-deploying from `main` with PR deploy previews

These are independent. GitHub Actions gates merges; Netlify handles the actual hosting.

---

## 1. Environment variables

All six values come from Firebase Console → Project Settings → Your apps → SDK setup and configuration. The Firebase web config is public — it identifies the project but doesn't grant access (the Firestore/Storage security rules enforce auth). Env vars are still the right home because they enable dev/staging/prod separation.

**Required everywhere (local dev + GitHub Actions + Netlify):**

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

No other env vars are needed. The Anthropic API key is BYO per device (stored in `localStorage`), and Open-Meteo is keyless.

**Optional — for authenticated E2E tests:**

```
CYPRESS_TEST_EMAIL
CYPRESS_TEST_PASSWORD
```

These point to a Firebase test account used by Cypress to log in and test post-auth features (item form, photo inference, etc.). Tests that need them auto-skip when the vars are missing, so CI still passes without them. See below for setup.

### Local dev

Copy `.env.example` → `.env.local`, fill in values.

For authenticated E2E tests, also add `CYPRESS_TEST_EMAIL` and `CYPRESS_TEST_PASSWORD` to `.env`. The Cypress config loads them via Vite's `loadEnv`.

### GitHub Actions

Repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

Add each of the six keys above. The workflow in `.github/workflows/ci.yml` reads them via `${{ secrets.VITE_FIREBASE_* }}`.

> These don't need to be the production Firebase project — a separate test project works and is actually preferable. If you use a test project for CI, your E2E tests can exercise real Firebase without polluting production data.

### Netlify

Site → **Site configuration** → **Environment variables** → **Add a variable**.

Add the same six keys. Netlify injects them into the `npm run build` process when it builds.

---

## 2. Netlify project setup (one time)

1. Log in to [Netlify](https://app.netlify.com).
2. **Add new site** → **Import an existing project** → select the GitHub repo.
3. Build settings (Netlify should auto-detect from `netlify.toml`):
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Node version: `20` (from `netlify.toml`)
4. Set the six `VITE_FIREBASE_*` env vars (see above).
5. **Deploy site**.

After this, every push to `main` auto-deploys to production. Every PR gets a **deploy preview** at a unique URL, posted as a comment on the PR.

### SPA redirects

The router uses `history.pushState`, so direct URL hits on non-root paths must serve `index.html`. This is already configured in `netlify.toml`:

```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

---

## 3. CI workflow overview

`.github/workflows/ci.yml` runs on every PR and every push to `main`:

- **`checks` job**: lint → prettier → typecheck → unit tests → build
- **`e2e` job**: runs Cypress against a live `vite dev` server

Both jobs need `VITE_FIREBASE_*` because the Firebase init throws at startup when vars are missing. Cypress uploads screenshots as an artifact on failure.

The jobs run in parallel. PR merging should be gated on both passing (configure this in GitHub → repo settings → branches → branch protection rules → require status checks to pass).

### Authenticated E2E tests

Some Cypress tests (item form, photo inference) require a logged-in user. They use `CYPRESS_TEST_EMAIL` / `CYPRESS_TEST_PASSWORD` to sign in via the login form before each test.

- **Locally:** add `CYPRESS_TEST_EMAIL` and `CYPRESS_TEST_PASSWORD` to `.env` (gitignored). `cypress.config.ts` loads them via Vite's `loadEnv`.
- **CI:** add as GitHub Actions secrets (`CYPRESS_TEST_EMAIL`, `CYPRESS_TEST_PASSWORD`). If missing, the tests auto-skip rather than fail.

The test account should be on a test Firebase project (not production) so E2E runs don't pollute real data. Tests clean up after themselves (delete items they create).

---

## 4. Branch protection (recommended)

Repository → **Settings** → **Branches** → **Add branch protection rule** for `main`:

- ✅ Require a pull request before merging
- ✅ Require status checks to pass
  - `Lint / typecheck / unit tests / build`
  - `Cypress E2E`
- ✅ Require branches to be up to date before merging

This ensures no commit lands on `main` without passing CI, which in turn means no broken build can auto-deploy to Netlify.

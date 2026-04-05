# 🧳 Packrat

Personal inventory tracker with AI-assisted packing lists and weather-aware trip planning.

TypeScript · Vite · Firebase · Vitest.

For full architecture, data model, and design decisions see [docs/design.md](docs/design.md).

---

## Stack

TypeScript + Vite · Firebase Auth + Firestore + Storage · Open-Meteo (weather, free/keyless) · Anthropic Claude (BYO API key)

---

## Project structure

```
packrat/
├── index.html              view shell, nav, sheet, dialogs
├── src/
│   ├── main.ts             app entry, auth, view wiring
│   ├── firebase.ts         env-var-driven Firebase init
│   ├── types.ts            data model interfaces
│   ├── constants.ts        taxonomy, icons, AI model/URL
│   ├── utils.ts            DOM helpers, esc, sortOrderMidpoint
│   ├── csv.ts              RFC 4180 CSV parser
│   ├── weather.ts          geocode + climate aggregation
│   ├── ai.ts               Anthropic prompt + response parsing
│   ├── styles/             tokens / base / components / views
│   └── __tests__/          vitest pure-function tests
├── docs/design.md          full architecture spec
├── vite.config.ts
├── tsconfig.json
└── Makefile                wraps npm scripts + Netlify deploy
```

---

## Setup

### 1. Install

```
npm install
# or: make install
```

### 2. Firebase

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Authentication** → Email/Password
3. Enable **Firestore** → production mode → paste rules from [docs/design.md § 2.5](docs/design.md)
4. Enable **Storage** → production mode → paste rules from [docs/design.md § 2.5](docs/design.md)
5. Register a web app, copy the config

### 3. Environment variables

Copy the template and fill in your Firebase config:

```
cp .env.example .env.local
```

Then edit `.env.local` with values from the Firebase console. All keys are prefixed `VITE_FIREBASE_*` so Vite exposes them to the client bundle.

### 4. Run

```
make dev              # vite dev server (http://localhost:5173)
make test             # vitest run (unit tests)
npm run e2e           # cypress run (spins up dev server)
npm run e2e:open      # cypress open (interactive mode)
make typecheck        # tsc --noEmit (app + cypress)
npm run lint          # eslint
npm run format        # prettier --write
make build            # typecheck + production bundle → dist/
```

### 5. Add your Anthropic API key

Settings (⚙️) → **Anthropic API Key** → Save. Stored in `localStorage` only, never synced.

---

## CI + Deploy

`main` auto-deploys to Netlify; PRs get deploy previews. GitHub Actions runs lint/typecheck/unit tests/build/E2E on every PR.

See [docs/ci-deploy.md](docs/ci-deploy.md) for full setup (GitHub secrets, Netlify dashboard env vars, branch protection).

Quick manual deploy (from a local checkout):
```
npm i -g netlify-cli
netlify login
make deploy
```

---

## CSV import

Settings → **Download Template** for the expected columns, then **Choose CSV File** to bulk-load items. See [docs/design.md § 4.5](docs/design.md) for full format spec.

---

## Known limitations (v0.1)

- Single user, no sharing
- Last-write-wins on concurrent edits across devices
- Deleted photos may leave orphan blobs in Storage (no cleanup script yet)

---

## License

MIT

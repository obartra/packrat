.PHONY: dev open install build test e2e typecheck lint format clean deploy status logs help

# ── config ────────────────────────────────────────────────────
SITE ?=          # set with: make deploy SITE=your-site-name
# ─────────────────────────────────────────────────────────────

install:
	npm install

dev:
	npm run dev

open:
	@open http://localhost:5173 2>/dev/null || xdg-open http://localhost:5173

build:
	npm run build

test:
	npm run test

e2e:
	npm run e2e

typecheck:
	npm run typecheck

lint:
	npm run lint

format:
	npm run format

clean:
	@rm -rf dist

deploy: build
	@command -v netlify >/dev/null 2>&1 || { echo "netlify CLI not found — run: npm i -g netlify-cli"; exit 1; }
	netlify deploy --prod --dir dist $(if $(SITE),--site $(SITE),)

status:
	@command -v netlify >/dev/null 2>&1 || { echo "netlify CLI not installed"; exit 1; }
	netlify status

logs:
	@command -v netlify >/dev/null 2>&1 || { echo "netlify CLI not installed"; exit 1; }
	netlify logs

help:
	@echo ""
	@echo "  make install          install npm dependencies"
	@echo "  make dev              start Vite dev server"
	@echo "  make open             open browser to localhost:5173"
	@echo "  make build            typecheck + vite build → dist/"
	@echo "  make test             run vitest unit tests"
	@echo "  make e2e              run cypress E2E (boots dev server)"
	@echo "  make typecheck        run tsc --noEmit (app + cypress)"
	@echo "  make lint             run eslint"
	@echo "  make format           run prettier --write"
	@echo "  make clean            remove dist/"
	@echo "  make deploy           build + deploy to Netlify (prompts for site on first run)"
	@echo "  make deploy SITE=xyz  deploy to a specific Netlify site name"
	@echo "  make status           show Netlify account + linked site"
	@echo "  make logs             tail Netlify function logs"
	@echo ""
	@echo "  First-time setup:"
	@echo "    make install"
	@echo "    cp .env.example .env.local    # fill in Firebase config"
	@echo "    make dev"
	@echo ""

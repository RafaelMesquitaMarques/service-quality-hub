# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install all dependencies (root + client + server)
npm run install:all

# Start both dev servers (client :5173, server :3001)
npm run dev

# Start individually
npm run dev:client
npm run dev:server

# Build frontend for production
npm run build

# Tests of the Reports module engine (filters, aggregations, xlsx/csv export, permissions, i18n)
npm run test:reports

# Tests of the Dashboard calculations (event = line, cost rule, YoY to date, SC%, fiscal calendar)
npm run test:dashboard

# Production container (Vite build served by nginx) on http://localhost:8080
# needs a root .env (template: .env.example; gitignored)
docker compose up --build -d
```

No linting is configured; `test:reports` and `test:dashboard` are the automated test suites (Node ≥ 22, no dependency).

## Architecture

This is a full-stack quality defect tracking app for Foliot Furniture. The `client/` is a React/Vite SPA; `server/` is an Express API (currently mostly unused — see below).

### Key architectural detail: the frontend talks directly to Supabase

All API calls in `client/src/services/api.js` use the Supabase JS client directly — they do **not** go through the Express server. The Express backend (`server/`) exists for operations that require a service key (e.g., admin user management, Excel import) but the frontend bypasses it for almost everything. When adding features, use `supabase` client calls in `api.js`, not `fetch`/`axios` to the Express server.

### Frontend (`client/src/`)

- **Routing**: `main.jsx` — two separate route trees: desktop (`/` via `Layout`) and mobile (`/mobile/*` via `MobileLayout`)
- **State**: Zustand — `authStore.js` (session + user profile), `themeStore.js` (dark mode)
- **Data fetching**: TanStack Query wraps calls to `api.js`
- **Permissions**: `usePermissions.js` — derives capabilities from `user.role` with optional per-user overrides via `perm_*` boolean fields on `user_profiles`
- **i18n**: react-i18next, translations in `i18n/fr.json` and `i18n/en.json`
- **Icons**: Tabler Icons loaded via CDN (`ti ti-*` CSS classes)

### Database (Supabase/PostgreSQL)

Core tables: `tickets`, `user_profiles`, `meetings`, `ticket_photos`, `ticket_history`, `plants`.

**Important**: ticket reads use the `tickets_with_cost` **view**, not the raw `tickets` table. Writes go to `tickets`.

### Fiscal calendar

Foliot's fiscal year starts in December. December = fiscal month 1 of the **next** calendar year. The helpers `getFiscalYear()` and `getFiscalMonth()` live in `utils/fiscal.js` (re-exported by `api.js`). `CURRENT_FISCAL_YEAR` / `currentFiscalYear()` are computed from today's date — never hardcode a year. `tickets.fiscal_year` / `fiscal_month` / `date_yyyy_mm` are derived from `issue_reception_date` (recomputed by `ticketApi.update` and by the DB trigger of migration 2026-10-26).

### Dashboard calculations

All dashboard numbers come from the pure module `client/src/pages/Dashboard/metrics.js` (tested by `test:dashboard`); `index.jsx` only loads and renders. Rules: scope = statuses `quality_meeting` + `completed`; **1 event = 1 occurrence line** (an occurrence without lines counts 1, an untitled line 0) so app data compares with the imported Excel history; cost = Σ line `cost_approx` as soon as one line is costed, else the header cost; department/plant/category from the line with header fallback; client = `project_name || ship_to`; YoY for the current FY compares with the previous FY cut at the same date.

### Roles & permissions

Five roles: `admin > manager > cpm > service_desk > viewer`. The `usePermissions` hook in `client/src/hooks/usePermissions.js` resolves each capability, first checking a `perm_*` field on the user profile (explicit override), then falling back to a role-based default. Always gate UI and mutations through this hook.

### Environment variables

**Client** (`client/.env.local`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`

**Server** (`server/.env`): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, `CORS_ORIGIN`, `PORT`

### Deployment

- Frontend: Vercel (auto-deploy from `main`) — `client/vercel.json` configures SPA routing
- Backend: Railway
- Database + Storage + Auth: Supabase (project `kbunsdmpesivntujvuzi`)
- Container: `docker-compose.yml` (project `ai_checkmate`) runs a single `web` service built from `client/Dockerfile` (Vite build → nginx; `client/nginx.conf` does the SPA fallback and caching that `vercel.json` does on Vercel), published on 15105. IT gave this app the ports 15105–15109 on the Azure VMs; publish nothing else. `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are **build args** whose compose defaults are the public values of `client/.env.local` (update both together if the keys change), so the servers need no `.env`; a root `.env` overrides them and `WEB_PORT` (template: `.env.example`). Supabase stays hosted; the Express server is not in the stack. `client/package-lock.json` must stay committed (`npm ci`).
- Azure DevOps repo `AI_CheckMate` = git remote `azure`. A push to its `dev` or `qa` branch **is a deployment** (DEV / QA servers): ask the user before each one. Its history starts with a template README commit unrelated to ours, so the Azure line is the local branch `azure-dev`: to sync, merge `main` into `azure-dev`, then `git push azure azure-dev:dev`. Never push `azure-dev` to `origin` (public GitHub).

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
```

No linting or test scripts are configured.

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

Foliot's fiscal year starts in December. December = fiscal month 1 of the **next** calendar year. The helpers `getFiscalYear()` and `getFiscalMonth()` in `api.js` implement this. `CURRENT_FISCAL_YEAR` is a hardcoded constant that needs updating annually.

### Roles & permissions

Five roles: `admin > manager > cpm > service_desk > viewer`. The `usePermissions` hook in `client/src/hooks/usePermissions.js` resolves each capability, first checking a `perm_*` field on the user profile (explicit override), then falling back to a role-based default. Always gate UI and mutations through this hook.

### Environment variables

**Client** (`client/.env.local`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`

**Server** (`server/.env`): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET`, `CORS_ORIGIN`, `PORT`

### Deployment

- Frontend: Vercel (auto-deploy from `main`) — `client/vercel.json` configures SPA routing
- Backend: Railway
- Database + Storage + Auth: Supabase (project `kbunsdmpesivntujvuzi`)

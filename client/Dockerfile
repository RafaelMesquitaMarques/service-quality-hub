# Production image of the SPA: Vite builds the bundle, nginx serves it.
# The Supabase URL and anon key are inlined by Vite at build time
# (import.meta.env), so they arrive as build args from the server's .env
# (see docker-compose.yml and .env.example). Changing them needs a rebuild.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_ANON_KEY" \
 || { echo "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing: put them in .env (see .env.example)" >&2; exit 1; }
RUN npm run build

FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/healthz || exit 1

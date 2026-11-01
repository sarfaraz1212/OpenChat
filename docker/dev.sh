#!/bin/sh
# Starts the same local Worker as `pnpm dev`. Migrations are always --local.
# This script never deploys and never calls a remote D1.
set -eu

if [ -z "${CSRF_SECRET:-}" ]; then
  echo "CSRF_SECRET is empty. Copy .dev.vars.example to .dev.vars and set it to 32 or more random characters." >&2
  exit 1
fi

umask 077
{
  printf 'CSRF_SECRET=%s\n' "$CSRF_SECRET"
  printf 'CLOUDFLARE_ACCOUNT_ID=%s\n' "${CLOUDFLARE_ACCOUNT_ID:-}"
  printf 'CLOUDFLARE_API_TOKEN=%s\n' "${CLOUDFLARE_API_TOKEN:-}"
  printf 'BFL_API_KEY=%s\n' "${BFL_API_KEY:-}"
  printf 'TAVILY_API_KEY=%s\n' "${TAVILY_API_KEY:-}"
  printf 'PERPLEXITY_API_KEY=%s\n' "${PERPLEXITY_API_KEY:-}"
  printf 'SERPER_API_KEY=%s\n' "${SERPER_API_KEY:-}"
  printf 'CUSTOMERIO_API_KEY=%s\n' "${CUSTOMERIO_API_KEY:-}"
  printf 'APP_URL=%s\n' "${APP_URL:-}"
  printf 'EMAIL_FROM=%s\n' "${EMAIL_FROM:-}"
  printf 'CRON_SECRET=%s\n' "${CRON_SECRET:-}"
} > .dev.vars

pnpm exec wrangler d1 migrations apply openchat --local
exec pnpm exec vite --host 0.0.0.0 --port 5173 --strictPort

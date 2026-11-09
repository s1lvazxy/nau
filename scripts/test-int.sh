#!/bin/sh
# Integration tests against the local Supabase stack (supabase start).
# Keys are read from the running stack and never printed.
set -e
eval "$(supabase status -o env 2>/dev/null | grep -E '^(API_URL|PUBLISHABLE_KEY|ANON_KEY|SERVICE_ROLE_KEY)=' | sed 's/^/export /')"
if [ -z "$API_URL" ]; then
  echo "Supabase is not running. Start it with: supabase start" >&2
  exit 1
fi
INT=1 \
VITE_SUPABASE_URL="$API_URL" \
VITE_SUPABASE_PUBLISHABLE_KEY="${PUBLISHABLE_KEY:-$ANON_KEY}" \
SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
exec pnpm exec vitest run "$@"

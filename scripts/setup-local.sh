#!/bin/sh
# Full-feature Nau on localhost: points the env file at the local Supabase stack (supabase start)
# and generates the two server secrets. Values already set are left alone. Nothing is printed but key names.
set -e
ENV_FILE="${ENV_FILE:-.env}"
[ -f "$ENV_FILE" ] || cp .env.example "$ENV_FILE"

eval "$(supabase status -o env 2>/dev/null | grep -E '^(API_URL|PUBLISHABLE_KEY|ANON_KEY|SERVICE_ROLE_KEY)=' | sed 's/^/export /')"
if [ -z "$API_URL" ]; then
  echo "Supabase is not running. Start it with: supabase start" >&2
  exit 1
fi

set_if_empty() {
  key="$1"
  value="$2"
  current="$(grep -E "^$key=" "$ENV_FILE" | head -1 | cut -d= -f2-)"
  if [ -n "$current" ]; then
    echo "  kept  $key"
    return
  fi
  if grep -qE "^$key=" "$ENV_FILE"; then
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" 'index($0, k "=") == 1 && !done { print k "=" v; done = 1; next } { print }' "$ENV_FILE" > "$tmp"
    cat "$tmp" > "$ENV_FILE"
    rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
  echo "  set   $key"
}

echo "Writing $ENV_FILE"
set_if_empty VITE_SUPABASE_URL "$API_URL"
set_if_empty VITE_SUPABASE_PUBLISHABLE_KEY "${PUBLISHABLE_KEY:-$ANON_KEY}"
set_if_empty SUPABASE_SERVICE_ROLE_KEY "$SERVICE_ROLE_KEY"
set_if_empty NAU_SECRET_KEY "$(openssl rand -base64 32)"
set_if_empty CRON_SECRET "$(openssl rand -hex 24)"
echo "Done. Restart the dev server (pnpm dev). To run the scheduler once:"
echo '  curl -X POST -H "Authorization: Bearer $(grep ^CRON_SECRET= '"$ENV_FILE"' | cut -d= -f2-)" http://localhost:3100/api/cron/tick'

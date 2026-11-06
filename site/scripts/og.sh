#!/usr/bin/env bash
# Rebuilds the link-preview image from the home page's hero: builds the site, serves it on
# a fixed port, and screenshots it with og.mjs.
set -euo pipefail

cd "$(dirname "$0")/.."
port=4398
url="http://localhost:$port/"
pnpm astro build > /dev/null
# astro preview moves to a free port when $port is taken, which would leave this script
# screenshotting whatever already holds it.
if curl -s -o /dev/null "$url"; then
  echo "port $port is in use; stop the server holding it (lsof -iTCP:$port -sTCP:LISTEN)" >&2
  exit 1
fi
# --ignore-lock lets this run beside a preview server someone already has open. Node runs
# directly, not through the .bin shim, so the trap's kill reaches the server itself.
node node_modules/astro/bin/astro.mjs preview --port "$port" --ignore-lock > /dev/null &
preview=$!
trap 'kill $preview 2> /dev/null' EXIT
for _ in $(seq 150); do
  curl -sf "$url" > /dev/null 2>&1 && break
  kill -0 "$preview" 2> /dev/null || { echo "astro preview exited before serving" >&2; exit 1; }
  sleep 0.2
done
curl -sf "$url" > /dev/null 2>&1 || { echo "astro preview did not answer within 30s" >&2; exit 1; }
node scripts/og.mjs "$port"

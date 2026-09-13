#!/usr/bin/env bash
# Smoke check for a deployed Crosstune. It needs no credentials: it proves the API is
# up, that the web origin serves the app shell, and that the web origin reaches the API.
set -euo pipefail

usage="usage: $0 <api-origin> <web-origin>"
api="${1:?$usage}"
web="${2:?$usage}"
api="${api%/}"
web="${web%/}"
failed=0

pass() { printf 'ok    %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; failed=1; }
headers_of() { curl -sS -o /dev/null -D - "$@" | tr -d '\r'; }
status_of() { curl -sS -o /dev/null -w '%{http_code}' "$@"; }

name="API /healthz answers ok"
if [ "$(curl -sS "$api/healthz")" = '{"status":"ok"}' ]; then pass "$name"; else fail "$name"; fi

name="API rejects an anonymous call with a problem document"
h="$(headers_of "$api/v1/me" || true)"
if grep -q '^HTTP/[0-9.]* 401' <<<"$h" && grep -qi '^content-type: application/problem+json' <<<"$h"; then
  pass "$name"
else
  fail "$name"
fi

name="web proxies /v1/me to the API and returns its 401 problem document"
h="$(headers_of "$web/v1/me" || true)"
if grep -q '^HTTP/[0-9.]* 401' <<<"$h" && grep -qi '^content-type: application/problem+json' <<<"$h"; then
  pass "$name"
else
  fail "$name"
fi

name="web serves the app shell"
if curl -sS "$web/" | grep -q '<div id="root">'; then pass "$name"; else fail "$name"; fi

name="web serves the manifest"
if curl -sS "$web/manifest.webmanifest" | grep -q 'Crosstune'; then pass "$name"; else fail "$name"; fi

name="web serves the service worker"
if [ "$(status_of "$web/sw.js")" = 200 ]; then pass "$name"; else fail "$name"; fi

name="web serves the shell for a client-side route"
if curl -sS "$web/songs/new" | grep -q '<div id="root">'; then pass "$name"; else fail "$name"; fi

exit "$failed"

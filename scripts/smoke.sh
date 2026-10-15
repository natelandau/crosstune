#!/usr/bin/env bash
# Smoke check for a deployed Crosstune. It needs no credentials: it proves the API is
# up, that the web origin serves the app shell and reaches the API, and, when a site
# origin is given, that the site serves its pages.
# `check` calls each probe by name, which shellcheck cannot follow.
# shellcheck disable=SC2329
set -euo pipefail

usage="usage: $0 <api-origin> <web-origin> [<site-origin>]"
api="${1:?$usage}"
web="${2:?$usage}"
site="${3:-}"
api="${api%/}"
web="${web%/}"
site="${site%/}"
failed=0

pass() { printf 'ok    %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; failed=1; }
check() {
  local name="$1"
  shift
  if "$@"; then pass "$name"; else fail "$name"; fi
}
# A hung origin fails its check instead of stalling the run.
fetch() { curl -sS --max-time 20 "$@"; }
headers_of() { fetch -o /dev/null -D - "$@" | tr -d '\r'; }
status_is() { [ "$(fetch -o /dev/null -w '%{http_code}' "$1" || true)" = "$2" ]; }
body_is() { [ "$(fetch "$1" || true)" = "$2" ]; }
# Captured, not piped: grep -q exits at the first match, and under pipefail curl's SIGPIPE fails the check.
body_has() { local body; body="$(fetch "$1" || true)"; grep -q "$2" <<<"$body"; }
# True when the response to $1 has status $2 and a header matching $3, matched case-insensitively.
header_has() {
  local h
  h="$(headers_of "$1" || true)"
  grep -q "^HTTP/[0-9.]* $2" <<<"$h" && grep -qi "^$3" <<<"$h"
}

check "API /healthz answers ok" body_is "$api/healthz" '{"status":"ok"}'
check "API rejects an anonymous call with a problem document" \
  header_has "$api/v1/me" 401 'content-type: application/problem+json'
check "web proxies /v1/me to the API and returns its 401 problem document" \
  header_has "$web/v1/me" 401 'content-type: application/problem+json'
check "web serves the app shell" body_has "$web/" '<div id="root">'
check "web serves the manifest" body_has "$web/manifest.webmanifest" 'Crosstune'
check "web serves the service worker" status_is "$web/sw.js" 200
check "web serves the shell for a client-side route" body_has "$web/tunes/new" '<div id="root">'

# Site checks: the static site at the apex, which never proxies the API.
if [ -n "$site" ]; then
  check "site serves the home page" body_has "$site/" 'id="hero-title"'
  for page in privacy terms support; do
    check "site serves /$page" status_is "$site/$page" 200
  done
  for path in /waitlist /waitlist/; do
    check "site redirects $path to sign-up" header_has "$site$path" 302 'location: https://my\.crosstune\.app/sign-up'
  done
  check "site serves a service worker that revalidates on every visit" \
    header_has "$site/sw.js" 200 'cache-control: no-cache'
  # The site has no /v1 route, so its 404 page answers; anything else means a proxy or an outage.
  check "site does not proxy the API" status_is "$site/v1/me" 404
fi

exit "$failed"

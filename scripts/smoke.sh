#!/usr/bin/env bash
# Smoke check for a deployed Crosstune. It needs no credentials: it proves the API is
# up, that the web origin serves the app shell and reaches the API, and, when a site
# origin is given, that the site serves its pages.
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
# A hung origin fails its check instead of stalling the run.
fetch() { curl -sS --max-time 20 "$@"; }
headers_of() { fetch -o /dev/null -D - "$@" | tr -d '\r'; }
status_of() { fetch -o /dev/null -w '%{http_code}' "$@"; }
# Captured, not piped: grep -q exits at the first match, and under pipefail curl's SIGPIPE fails the check.
body_has() { local body; body="$(fetch "$1" || true)"; grep -q "$2" <<<"$body"; }

name="API /healthz answers ok"
if [ "$(fetch "$api/healthz" || true)" = '{"status":"ok"}' ]; then pass "$name"; else fail "$name"; fi

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
if body_has "$web/" '<div id="root">'; then pass "$name"; else fail "$name"; fi

name="web serves the manifest"
if body_has "$web/manifest.webmanifest" 'Crosstune'; then pass "$name"; else fail "$name"; fi

name="web serves the service worker"
if [ "$(status_of "$web/sw.js")" = 200 ]; then pass "$name"; else fail "$name"; fi

name="web serves the shell for a client-side route"
if body_has "$web/tunes/new" '<div id="root">'; then pass "$name"; else fail "$name"; fi

# Site checks: the static site at the apex, which never proxies the API.
if [ -n "$site" ]; then
  name="site serves the home page"
  if body_has "$site/" 'id="hero-title"'; then pass "$name"; else fail "$name"; fi

  for page in privacy terms support waitlist/thanks; do
    name="site serves /$page"
    if [ "$(status_of "$site/$page")" = 200 ]; then pass "$name"; else fail "$name"; fi
  done

  for path in /waitlist /waitlist/; do
    name="site redirects $path to the waitlist form"
    h="$(headers_of "$site$path" || true)"
    if grep -q '^HTTP/[0-9.]* 302' <<<"$h" && grep -qi '^location: .*/#waitlist' <<<"$h"; then
      pass "$name"
    else
      fail "$name"
    fi
  done

  name="site serves a service worker that revalidates on every visit"
  h="$(headers_of "$site/sw.js" || true)"
  if grep -q '^HTTP/[0-9.]* 200' <<<"$h" && grep -qi '^cache-control: no-cache' <<<"$h"; then
    pass "$name"
  else
    fail "$name"
  fi

  # The site has no /v1 route, so its 404 page answers; anything else means a proxy or an outage.
  name="site does not proxy the API"
  if [ "$(status_of "$site/v1/me" || true)" = 404 ]; then pass "$name"; else fail "$name"; fi
fi

exit "$failed"

#!/usr/bin/env bash
# Prints an apple/Config/Local.xcconfig for this Mac. A device cannot reach the Mac's
# localhost, so a device's Debug build reaches `just dev` through Tailscale Serve
# (`tailscale serve 5173`), whose dev server proxies /v1 to the API and /storage to RustFS.
set -euo pipefail

host="$(tailscale status --self --json 2>/dev/null |
  python3 -c 'import json, sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null || true)"

cat <<'EOF'
// Overrides for this Mac, made by `just apple::setup` and copied into each worktree by
// `just worktree`. Git ignores it, and only Debug.xcconfig includes it, so no release build
// can pick up a developer's origin.

// A device cannot reach the Mac's localhost, so a Debug build on a phone or iPad goes through
// Tailscale Serve to `just dev`. Run `tailscale serve 5173` on the Mac, and list `.ts.net` in
// web/.env's LOCAL_ALLOWED_HOSTS. The Simulator and the Mac keep localhost.
EOF

if [[ -n "$host" ]]; then
  # An xcconfig reads `//` as a comment, so `$()` splits the scheme's slashes.
  origin="https:/\$()/$host"
  printf 'CROSSTUNE_API_ORIGIN[sdk=iphoneos*] = %s\n' "$origin"
  printf 'CROSSTUNE_STORAGE_ORIGIN[sdk=iphoneos*] = %s\n' "$origin"
else
  cat <<'EOF'
// Tailscale was not running when this was made. Set both to the Mac's Serve URL:
// CROSSTUNE_API_ORIGIN[sdk=iphoneos*] = https:/$()/<mac>.<tailnet>.ts.net
// CROSSTUNE_STORAGE_ORIGIN[sdk=iphoneos*] = https:/$()/<mac>.<tailnet>.ts.net
EOF
fi

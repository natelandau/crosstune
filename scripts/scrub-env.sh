#!/usr/bin/env bash
# Runs a command without the caller's credential-like environment variables. Xcode's build
# description and SwiftPM's plugin cache store the whole environment in plain text under
# .build/, so anything that copies or caches that folder would carry them along.
set -euo pipefail

while read -r name; do
  case "$name" in
    *KEY* | *TOKEN* | *SECRET* | *PASSWORD* | *PASSWD* | *CREDENTIAL*) unset "$name" ;;
  esac
done < <(compgen -e)

exec "$@"

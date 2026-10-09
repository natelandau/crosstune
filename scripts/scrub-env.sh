#!/usr/bin/env bash
# Runs a command without the caller's credential-like environment variables. Xcode's build
# description and SwiftPM's plugin cache store the whole environment in plain text under
# .build/, so anything that copies or caches that folder would carry them along.
set -euo pipefail

shopt -s nocasematch
while read -r name; do
  case "$name" in
    *KEY* | *TOKEN* | *SECRET* | *PASS* | *PRIVATE* | *CREDENTIAL*) unset "$name" ;;
  esac
done < <(compgen -e)

exec "$@"

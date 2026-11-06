#!/usr/bin/env bash
# Usage: archive.sh BUILD_NUMBER
# Archives the signed Release build for iOS and macOS into .build/archives, ready for
# `just apple::upload`. Reads ASC_KEY_PATH, ASC_KEY_ID, and ASC_ISSUER_ID from the
# environment: an App Store Connect API key with the Admin role, which cloud signing needs.
set -euo pipefail

cd "$(dirname "$0")/.."
build_number="${1:?usage: archive.sh BUILD_NUMBER}"
: "${ASC_KEY_PATH:?the path of the .p8 key file}" "${ASC_KEY_ID:?the key ID}" "${ASC_ISSUER_ID:?the issuer ID}"
# A dotenv file does not expand `~`.
ASC_KEY_PATH="${ASC_KEY_PATH/#\~/$HOME}"
xcodebuild=scripts/xcodebuild.sh
archives=.build/archives

# An empty token ships a release that silently sends no analytics. Reading the settings
# whole lets a failed xcodebuild stop here instead of reading as an empty token.
settings="$("$xcodebuild" -showBuildSettings -project Crosstune.xcodeproj -scheme Crosstune \
  -configuration Release -derivedDataPath .build/DerivedData)"
if ! grep -qE '^ *POSTHOG_PROJECT_TOKEN = phc_' <<< "$settings"; then
  echo "POSTHOG_PROJECT_TOKEN is empty; set it in Config/Secrets.xcconfig" >&2
  exit 1
fi
if ! grep -qE '^ *SENTRY_DSN = https://' <<< "$settings"; then
  echo "SENTRY_DSN is empty; set it in Config/Secrets.xcconfig" >&2
  exit 1
fi
rm -rf "$archives"
for platform in iOS macOS; do
  "$xcodebuild" archive -quiet -project Crosstune.xcodeproj -scheme Crosstune \
    -configuration Release -destination "generic/platform=$platform" \
    -derivedDataPath .build/DerivedData -archivePath "$archives/$platform.xcarchive" \
    CURRENT_PROJECT_VERSION="$build_number" -allowProvisioningUpdates \
    -authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" \
    -authenticationKeyIssuerID "$ASC_ISSUER_ID"
done

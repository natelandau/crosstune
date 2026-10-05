#!/usr/bin/env bash
# Creates, reads, and deletes a pull request's Railway preview environment for the Preview
# workflow.
#
# Usage: preview-railway.sh up | hostname | down
#
# Every command needs PR_NAME, RAILWAY_API_TOKEN, RAILWAY_CLI_IMAGE, RAILWAY_PROJECT_ID,
# RAILWAY_ENVIRONMENT_ID, and RAILWAY_API_SERVICE_ID. `up` also needs NEON_DB_URL,
# HEAD_REF, STORAGE_ACCESS_KEY_ID_PREVIEW, and STORAGE_SECRET_ACCESS_KEY_PREVIEW.
# `hostname` writes `hostname=<host>` to GITHUB_OUTPUT.
set -euo pipefail

railway() {
  docker run --rm \
    -e RAILWAY_API_TOKEN -e RAILWAY_PROJECT_ID -e RAILWAY_ENVIRONMENT_ID \
    "$RAILWAY_CLI_IMAGE" railway "$@"
}

# Only a confirmed listing may say the environment is absent. An API error read as
# "absent" would make `up` try to create a duplicate and `down` leak the environment
# behind a green job, so the listing retries and then fails.
environment_exists() {
  local environments="" attempt
  for attempt in 1 2 3; do
    if environments="$(railway environment list --json)"; then
      break
    fi
    environments=""
    sleep $((attempt * 10))
  done
  if [[ -z "$environments" ]]; then
    printf '%s\n' "::error::could not list Railway environments, so the state of $PR_NAME is unknown; rerun this workflow"
    exit 1
  fi
  jq -e --arg n "$PR_NAME" '[.. | objects | select(.name? == $n)] | length > 0' \
    <<<"$environments" >/dev/null
}

# Railway's built-in PR environments copy the base environment's variables and would
# reuse the development database; the CLI accepts the branch's connection string at
# creation. The existence check, rather than the event type, decides whether to create:
# a cancelled or failed first run must be healed by the next push. Every run also points
# an existing environment at the preview bucket.
up() {
  : "${NEON_DB_URL:?the Neon create step produced no db_url}"
  printf '%s\n' "::add-mask::$NEON_DB_URL"
  # The copy of development brings development's database, bucket, and token, so these
  # always replace them. The API refuses to start on the copied storage values if one is
  # missed. One list feeds both paths, so an existing environment whose first patch
  # failed heals on the next push.
  local api_vars=(
    "CROSSTUNE_DATABASE_URL=$NEON_DB_URL"
    "CROSSTUNE_ENVIRONMENT=$PR_NAME"
    "CROSSTUNE_STORAGE_BUCKET=crosstune-recordings-preview"
    "CROSSTUNE_STORAGE_ACCESS_KEY_ID=$STORAGE_ACCESS_KEY_ID_PREVIEW"
    "CROSSTUNE_STORAGE_SECRET_ACCESS_KEY=$STORAGE_SECRET_ACCESS_KEY_PREVIEW"
    "CROSSTUNE_STORAGE_PREFIX=$PR_NAME/"
  )
  local pair
  if environment_exists; then
    printf '%s\n' "Railway environment $PR_NAME already exists"
    # Set only what differs, because every set redeploys the service.
    local current changes=()
    current="$(railway variable list --service "$RAILWAY_API_SERVICE_ID" --environment "$PR_NAME" --json)"
    for pair in "${api_vars[@]}"; do
      if [[ "$(jq -r --arg k "${pair%%=*}" '.[$k] // ""' <<<"$current")" != "${pair#*=}" ]]; then
        changes+=("$pair")
      fi
    done
    if [[ "${#changes[@]}" -gt 0 ]]; then
      railway variable set "${changes[@]}" --service "$RAILWAY_API_SERVICE_ID" --environment "$PR_NAME"
    fi
  else
    local var_flags=()
    for pair in "${api_vars[@]}"; do
      var_flags+=(--service-config "$RAILWAY_API_SERVICE_ID" "variables.${pair%%=*}.value" "${pair#*=}")
    done
    railway environment new "$PR_NAME" --copy "$RAILWAY_ENVIRONMENT_ID" \
      "${var_flags[@]}" \
      --service-config "$RAILWAY_API_SERVICE_ID" source.branch "$HEAD_REF" \
      --service-config "$RAILWAY_API_SERVICE_ID" deploy.sleepApplication true
  fi
}

read_hostname() {
  local first_domain='[.. | objects | select(has("domain")) | .domain] | first // empty'
  local listed hostname created=""
  # The raw CLI output is kept so a failed read shows what the CLI said.
  listed="$(railway domain list --service "$RAILWAY_API_SERVICE_ID" --environment "$PR_NAME" --json 2>&1 || true)"
  hostname="$(jq -r "$first_domain" <<<"$listed" 2>/dev/null || true)"
  if [[ -z "$hostname" ]]; then
    created="$(railway domain --service "$RAILWAY_API_SERVICE_ID" --environment "$PR_NAME" --json 2>&1 || true)"
    # The create call's output is not relied on; the list is the source of truth.
    listed="$(railway domain list --service "$RAILWAY_API_SERVICE_ID" --environment "$PR_NAME" --json 2>&1 || true)"
    hostname="$(jq -r "$first_domain" <<<"$listed" 2>/dev/null || true)"
  fi
  if [[ -z "$hostname" ]]; then
    printf '%s\n' "::error::no Railway domain for $PR_NAME"
    printf '%s\n' "domain list output: $listed"
    printf '%s\n' "domain create output: $created"
    exit 1
  fi
  printf 'hostname=%s\n' "$hostname" >> "$GITHUB_OUTPUT"
}

down() {
  if environment_exists; then
    railway environment delete "$PR_NAME" --yes || {
      printf '%s\n' "::error::could not delete Railway environment $PR_NAME; rerun this workflow"
      exit 1
    }
  else
    printf '%s\n' "no Railway environment named $PR_NAME"
  fi
}

case "${1:-}" in
  up) up ;;
  hostname) read_hostname ;;
  down) down ;;
  *)
    printf '%s\n' "usage: $0 up | hostname | down" >&2
    exit 2
    ;;
esac

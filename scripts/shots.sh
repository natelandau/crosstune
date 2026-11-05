#!/usr/bin/env bash
# Captures the branch's UI and its merge base with main on each platform the branch touched,
# keeps only the shots that differ, and builds one review page from them in
# .cache/shots/review/index.html. Base shots are cached by commit in the main checkout, so
# every branch on the same base reuses them.
set -euo pipefail

usage="usage: $0 [--platform web|mac|ios]... [NAME...]
NAME: SampleScreen cases for the Mac and iOS captures (tune, catalog-filters, settings-account).
The web capture takes no names: it captures its whole gallery.
Without --platform, the platforms are the ones the branch's changes since main touch."

platforms=()
names=()
while (($#)); do
  case "$1" in
    --platform) platforms+=("$2"); shift 2 ;;
    -h | --help) printf '%s\n' "$usage"; exit 0 ;;
    -*) printf '%s\n' "$usage" >&2; exit 2 ;;
    *) names+=("$1"); shift ;;
  esac
done
for platform in ${platforms[@]+"${platforms[@]}"}; do
  case "$platform" in web | mac | ios) ;; *) printf '%s\n' "$usage" >&2; exit 2 ;; esac
done

root="$(git rev-parse --show-toplevel)"
main_checkout="$(dirname "$(cd "$(git rev-parse --git-common-dir)" && pwd)")"
base="$(git merge-base main HEAD)"
head="$(git rev-parse HEAD)"
shots="$root/.cache/shots"
cache="$main_checkout/.cache/shots/base/$base"
base_tree="$main_checkout/.worktrees/shots-base"

# Prints the platforms whose UI the changes since the base touch, committed or not.
touched() {
  local changed
  changed="$({ git diff --name-only "$base"; git ls-files --others --exclude-standard; } | sort -u)"
  # Not piped into `grep -q`, whose early exit can fail the pipeline under pipefail.
  if [[ -n "$(grep -E '^web/(src/|index\.html|public/)' <<< "$changed" | grep -vE '\.test\.tsx?$' || true)" ]]; then
    printf 'web\n'
  fi
  if grep -qE '^apple/(Crosstune/|CrosstuneKit/Sources/(CrosstuneUI|CrosstuneDesign)/)' <<< "$changed"; then
    printf 'mac\nios\n'
  fi
}

if ((${#platforms[@]} == 0)); then
  while IFS= read -r platform; do platforms+=("$platform"); done < <(touched)
fi
if ((${#platforms[@]} == 0)); then
  printf 'no UI change since main: nothing to capture\n'
  exit 0
fi

sample_screens="apple/CrosstuneKit/Sources/CrosstuneUI/Sample/SampleScreen.swift"
# Prints the names of the SampleScreen cases in the Swift source on stdin.
screen_cases() {
  sed -nE 's/^ *case ([a-zA-Z]+)( = "([a-z-]+)")?$/\1 \3/p' | awk '{ print ($2 == "" ? $1 : $2) }'
}

# A name SampleScreen does not know opens the plain shell, which would pass for a capture.
branch_cases="$(screen_cases < "$root/$sample_screens")"
for name in ${names[@]+"${names[@]}"}; do
  [[ "$name" == settings-* ]] || grep -qxF "$name" <<< "$branch_cases" ||
    { printf 'no SampleScreen case is named %s\n' "$name" >&2; exit 2; }
done

# The names in "${@:2}" the base can capture on platform $1. A case new on the branch has no
# base shot, so it shows as added, and iOS has no Settings tabs.
base_names() {
  local platform="$1" known name
  shift
  known="$(git show "$base:$sample_screens" 2> /dev/null | screen_cases || true)"
  for name in "$@"; do
    if [[ "$name" == settings-* ]]; then
      [[ "$platform" == ios ]] || printf '%s\n' "$name"
    elif grep -qxF "$name" <<< "$known"; then
      printf '%s\n' "$name"
    fi
  done
}

notes=()
captured=()
for platform in "${platforms[@]}"; do
  if [[ "$platform" != web ]] && ((${#names[@]} == 0)); then
    notes+=("$platform: not captured, since no screen names were given")
  else
    captured+=("$platform")
  fi
done

# The base commit, checked out in a detached worktree every run reuses, so its web
# dependencies stay installed. It needs no database or bucket, so it is not made with
# `just worktree`. Its Apple builds take 11 GB or more and go stale once main moves, while
# the shots stay cached, so they are deleted when the run ends, failed or not.
base_checkout() {
  trap 'rm -rf "$base_tree/apple/.build"' EXIT
  if [[ ! -d "$base_tree" ]]; then
    # A folder deleted by hand stays registered, and git refuses to add it again.
    git -C "$main_checkout" worktree prune
    git -C "$main_checkout" worktree add --detach "$base_tree" "$base" > /dev/null
  fi
  git -C "$base_tree" checkout --force --detach "$base" > /dev/null 2>&1
  git -C "$base_tree" clean -fdq -e node_modules -e .build
  local file
  for file in apple/Config/Secrets.xcconfig apple/Config/Local.xcconfig; do
    [[ ! -f "$main_checkout/$file" ]] || cp "$main_checkout/$file" "$base_tree/$file"
  done
}

# Captures platform $1 of the checkout at $2 into folder $3. Apple captures take only the
# names in "${@:4}", so a cached base can be topped up with the screens it lacks.
capture() {
  local platform="$1" checkout="$2" out="$3"
  shift 3
  mkdir -p "$out"
  case "$platform" in
    web)
      (cd "$checkout/web" && pnpm install --frozen-lockfile --silent)
      node "$root/web/scripts/gallery-shots.mjs" --web "$checkout/web" --out "$out" > /dev/null
      ;;
    mac)
      local look
      for look in light dark; do
        (cd "$checkout" && "$root/apple/scripts/mac-shots.sh" --out "$out" --appearance "$look" "$@") > /dev/null
      done
      ;;
    ios)
      local look build=()
      for look in light dark; do
        (cd "$checkout" && "$root/apple/scripts/ios-shots.sh" ${build[@]+"${build[@]}"} \
          --out "$out" --appearance "$look" "$@") > /dev/null
        build=(--no-build)
      done
      ;;
  esac
}

# The names in "$@" whose shots the folder $1 lacks, light or dark.
missing() {
  local folder="$1" name
  shift
  for name in "$@"; do
    compgen -G "$folder/$name-light--*" > /dev/null && compgen -G "$folder/$name-dark--*" > /dev/null ||
      printf '%s\n' "$name"
  done
}

rm -rf "$shots/branch" "$shots/review"
mkdir -p "$shots/review"
for platform in ${captured[@]+"${captured[@]}"}; do
  printf 'capturing %s at the base, %s\n' "$platform" "${base:0:10}"
  if [[ "$platform" == web ]]; then
    if [[ ! -e "$cache/web/.complete" ]]; then
      base_checkout
      rm -rf "$cache/web"
      capture web "$base_tree" "$cache/web"
      touch "$cache/web/.complete"
    fi
  else
    capturable=()
    while IFS= read -r name; do capturable+=("$name"); done < <(base_names "$platform" "${names[@]}")
    lacking=()
    while IFS= read -r name; do lacking+=("$name"); done < <(missing "$cache/$platform" ${capturable[@]+"${capturable[@]}"})
    if ((${#lacking[@]})); then
      base_checkout
      capture "$platform" "$base_tree" "$cache/$platform" "${lacking[@]}"
    fi
  fi

  printf 'capturing %s on the branch\n' "$platform"
  capture "$platform" "$root" "$shots/branch/$platform" ${names[@]+"${names[@]}"}

  # Only the named screens of the base's cache take part, since it can hold others.
  base_set="$cache/$platform"
  if [[ "$platform" != web ]]; then
    base_set="$shots/base/$platform"
    rm -rf "$base_set"
    mkdir -p "$base_set"
    for name in "${names[@]}"; do
      cp "$cache/$platform/$name-light--"* "$cache/$platform/$name-dark--"* "$base_set/" 2> /dev/null || true
    done
  fi
  node "$root/web/scripts/shots-diff.mjs" "$base_set" "$shots/branch/$platform" "$shots/review/$platform" |
    tail -n 1 | sed "s/^/$platform: /"
done

dirty=()
[[ -z "$(git status --porcelain)" ]] || dirty=(--dirty)
python3 "$root/scripts/shots_page.py" "$shots/review" ${dirty[@]+"${dirty[@]}"} \
  --branch "$(git branch --show-current)" --base "$base" --head "$head" \
  --platforms "${platforms[*]}" ${notes[@]+--note "${notes[@]}"}
for note in ${notes[@]+"${notes[@]}"}; do printf '%s\n' "$note"; done
printf 'review page: %s\n' "$shots/review/index.html"

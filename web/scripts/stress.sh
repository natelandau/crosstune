#!/usr/bin/env bash
# Usage: stress.sh RUNS [VITEST ARGS...]
# Runs tests shuffled RUNS times, by default the branch's changed test files. Shuffling
# exposes a test that leans on state an earlier test left behind, which file order hides.
# SEED=<n> replays one run.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
runs="${1:?usage: stress.sh RUNS [VITEST ARGS...]}"
shift
given="$*"
if (($# == 0)); then
  base=$(git merge-base main HEAD)
  files=()
  while IFS= read -r file; do files+=("$file"); done < <(
    { git diff --name-only --relative --diff-filter=AMR "$base"; git ls-files --others --exclude-standard; } |
      grep -E '\.test\.tsx?$' | sort -u
  )
  if ((${#files[@]} == 0)); then
    echo "no test files changed since main; pass files or vitest args to stress others"
    exit 0
  fi
  printf 'stressing %s\n' "${files[@]}"
  set -- "${files[@]}"
fi
if [[ -n "${SEED:-}" ]]; then
  exec pnpm vitest run --sequence.shuffle --sequence.seed="$SEED" "$@"
fi
failed=()
for run in $(seq 1 "$runs"); do
  seed=$RANDOM$RANDOM
  echo "run $run/$runs, seed $seed"
  pnpm vitest run --sequence.shuffle --sequence.seed="$seed" "$@" || failed+=("$seed")
done
if ((${#failed[@]})); then
  echo "${#failed[@]} of $runs runs failed; replay one with SEED=<seed> just web::stress 1 $given"
  printf '  %s\n' "${failed[@]}"
  exit 1
fi
echo "all $runs runs passed"

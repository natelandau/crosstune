#!/usr/bin/env bash
# Runs ffmpeg, ffprobe, and prlimit inside the API image's media stage, so local runs, CI,
# and production decode audio with one ffmpeg build. Prints a directory of wrappers to put
# first on PATH.
set -euo pipefail

docker info > /dev/null 2>&1 || { echo "Docker is not running" >&2; exit 1; }

here="$(cd "$(dirname "$0")" && pwd -P)"
# The main checkout, which holds every worktree, so one container serves them all.
root="$(dirname "$(git -C "$here" rev-parse --path-format=absolute --git-common-dir)")"
image=crosstune-api-media
docker build --quiet --target media --tag "$image" "$here/../api" > /dev/null
id="$(docker image inspect --format '{{.Id}}' "$image")"
id="${id#sha256:}"
id="${id:0:12}"
# Named for the image, so a branch that changes the media stage gets its own container and
# never restarts one another checkout is using.
container="crosstune-media-$id"

running() { [[ "$(docker inspect --format '{{.State.Running}}' "$container" 2> /dev/null)" == "true" ]]; }

if ! running; then
  docker container rm --force "$container" > /dev/null 2>&1 || true
  # The tools only ever read and write absolute paths under the temp directory or the
  # checkout, so those are mounted at the same paths. macOS's TMPDIR is a symlink that
  # Python and pytest each spell differently, so both spellings are mounted.
  mounts=(--volume "$root:$root")
  for dir in /tmp "${TMPDIR:-/tmp}"; do
    dir="${dir%/}"
    real="$(cd "$dir" && pwd -P)"
    mounts+=(--volume "$real:$dir")
    [[ "$real" == "$dir" ]] || mounts+=(--volume "$real:$real")
  done
  # The caller's own user runs the tools, so what they write stays the caller's to read
  # and delete. Another checkout starting the same container at once wins the name, which
  # is fine once the container runs.
  docker run --detach --name "$container" --user "$(id -u):$(id -g)" "${mounts[@]}" \
    --entrypoint sleep "$image" infinity > /dev/null 2>&1 || running
fi

bin="${TMPDIR:-/tmp}"
bin="${bin%/}/crosstune-media/$id"
mkdir -p "$bin"
# The API starts the tools through prlimit, which must run in the container too, or it
# would limit the docker client instead of the tool. docker exec passes on none of the
# caller's environment, and without the API's arena cap glibc reserves enough address
# space per thread to hit the memory limit.
for tool in ffmpeg ffprobe prlimit; do
  printf '#!/bin/sh\nexec docker exec --env MALLOC_ARENA_MAX %s %s "$@"\n' "$container" "$tool" > "$bin/$tool"
  chmod +x "$bin/$tool"
done

printf '%s\n' "$bin"

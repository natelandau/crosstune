#!/usr/bin/env bash
# Puts ffmpeg, ffprobe, and prlimit on a CI runner's PATH, running inside the API's own image, so CI
# decodes audio with the ffmpeg build production ships rather than the runner's package.
# Needs GITHUB_WORKSPACE and GITHUB_PATH, which every Actions job sets.
set -euo pipefail

image=crosstune-api-media
container=crosstune-media
docker build --quiet --tag "$image" "$GITHUB_WORKSPACE/api" > /dev/null
# The tools only ever read and write absolute paths under the temp directory or the
# checkout, so those are mounted at the same paths. The runner's own user runs them, so
# what they write stays the runner's to read and delete.
docker run --detach --name "$container" --user "$(id -u):$(id -g)" \
  --volume /tmp:/tmp --volume "$GITHUB_WORKSPACE:$GITHUB_WORKSPACE" \
  --entrypoint sleep "$image" infinity > /dev/null

bin="$(mktemp -d)"
# The API starts the tools through prlimit, which must run in the container too, or it
# would limit the docker client instead of the tool.
for tool in ffmpeg ffprobe prlimit; do
  printf '#!/bin/sh\nexec docker exec %s %s "$@"\n' "$container" "$tool" > "$bin/$tool"
  chmod +x "$bin/$tool"
done
echo "$bin" >> "$GITHUB_PATH"
"$bin/ffmpeg" -version | sed -n 1p

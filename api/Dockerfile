FROM ghcr.io/astral-sh/uv:0.13.0-python3.13-trixie-slim@sha256:40215b626e22e4ff65839863624c4b885b8829b1a66ce895b7be20eca7fabe6d AS builder
ENV UV_COMPILE_BYTECODE=1
WORKDIR /app
COPY uv.lock pyproject.toml ./
RUN uv sync --locked --no-dev --no-cache --no-install-project
COPY src/ ./src/
COPY alembic.ini ./
RUN uv sync --locked --no-dev --no-cache

# The DB-IP country database is fetched at build time. A failed download leaves the
# directory empty, and the API then runs without country lookups.
FROM curlimages/curl:8.11.1@sha256:c1fe1679c34d9784c1b0d1e5f62ac0a79fca01fb6377cdd33e90473c6f9f9a69 AS geo
USER root
# Unused by the script, but a new value per deploy misses the layer cache, so each deploy
# fetches the current file. Unset in a local build, which then caches as before.
ARG RAILWAY_GIT_COMMIT_SHA
RUN mkdir /geo && sh -c ' \
    year=$(date +%Y); month=$(date +%m); \
    prev_month=$((10#$month - 1)); prev_year=$year; \
    if [ "$prev_month" -eq 0 ]; then prev_month=12; prev_year=$((year - 1)); fi; \
    prev=$(printf "%04d-%02d" "$prev_year" "$prev_month"); \
    for stamp in "$year-$month" "$prev"; do \
        if curl -fsSL --retry 2 -o /tmp/db.mmdb.gz "https://download.db-ip.com/free/dbip-country-lite-$stamp.mmdb.gz" \
            && gunzip -c /tmp/db.mmdb.gz > /geo/dbip-country-lite.mmdb; then exit 0; fi; \
        rm -f /geo/dbip-country-lite.mmdb; \
    done; \
    echo "DB-IP download failed; building without a country database" >&2; exit 0'

# CI borrows this stage's ffmpeg without building the app.
FROM python:3.13-slim-trixie@sha256:70729b46c69b4f1e97c4822c1af3df53a1476cf5ddc6c087c0c10bc3a5678c2f AS media
RUN apt-get update && apt-get install -y --no-install-recommends tini ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1000 --create-home appuser
WORKDIR /app

FROM media
COPY --from=builder /app/.venv .venv
COPY --from=builder /app/src ./src
COPY --from=builder /app/alembic.ini ./
COPY --from=geo /geo ./geo
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER appuser
EXPOSE 8000
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "exec uvicorn crosstune.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

FROM ghcr.io/astral-sh/uv:0.12.23-python3.13-trixie-slim@sha256:a6aeb5c166af9f765f9c68e585b5a5148c28f3b8a362f90151cecea88b21a3e2 AS builder
ENV UV_COMPILE_BYTECODE=1
WORKDIR /app
COPY uv.lock pyproject.toml ./
RUN uv sync --locked --no-dev --no-cache --no-install-project
COPY src/ ./src/
COPY alembic.ini ./
RUN uv sync --locked --no-dev --no-cache

# CI borrows this stage's ffmpeg without building the app.
FROM python:3.13-slim-trixie@sha256:bf44cdfcb76cd3b41e879bc058fc37ec5872002ccfde7fcb765e218cde0cd79c AS media
RUN apt-get update && apt-get install -y --no-install-recommends tini ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1000 --create-home appuser
WORKDIR /app

FROM media
COPY --from=builder /app/.venv .venv
COPY --from=builder /app/src ./src
COPY --from=builder /app/alembic.ini ./
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER appuser
EXPOSE 8000
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "exec uvicorn crosstune.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

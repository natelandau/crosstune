FROM ghcr.io/astral-sh/uv:0.13.0-python3.13-trixie-slim@sha256:40215b626e22e4ff65839863624c4b885b8829b1a66ce895b7be20eca7fabe6d AS builder
ENV UV_COMPILE_BYTECODE=1
WORKDIR /app
COPY uv.lock pyproject.toml ./
RUN uv sync --locked --no-dev --no-cache --no-install-project
COPY src/ ./src/
COPY alembic.ini ./
RUN uv sync --locked --no-dev --no-cache

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
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER appuser
EXPOSE 8000
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "exec uvicorn crosstune.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

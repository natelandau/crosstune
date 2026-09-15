FROM ghcr.io/astral-sh/uv:0.12.10-python3.13-trixie-slim AS builder
ENV UV_COMPILE_BYTECODE=1
WORKDIR /app
COPY uv.lock pyproject.toml ./
RUN uv sync --locked --no-dev --no-cache --no-install-project
COPY src/ ./src/
COPY alembic.ini ./
RUN uv sync --locked --no-dev --no-cache

FROM python:3.13-slim-trixie
RUN apt-get update && apt-get install -y --no-install-recommends tini ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1000 --create-home appuser
WORKDIR /app
COPY --from=builder /app/.venv .venv
COPY --from=builder /app/src ./src
COPY --from=builder /app/alembic.ini ./
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER appuser
EXPOSE 8000
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "exec uvicorn crosstune.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

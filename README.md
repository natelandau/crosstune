# Crosstune

A tune catalog for folk musicians. `docs/product.md` says what it is and
why. `docs/README.md` indexes every page under `docs/`.

## Layout

- `api/` The FastAPI service. Python, managed by uv.
- `web/` The web client. TypeScript, managed by pnpm.
- `apple/` The iOS and macOS app. Swift, built with Xcode.
- `brand/` The CT mark as SVG, in both colorways. The web icons are
  generated from it.
- `docs/` The pages that hold what the code cannot say.

## Working on it

`docs/operations.md` covers setup, running, testing, committing, and
releasing. The short version:

```bash
just dev-setup   # once
just dev         # Postgres, migrations, the API on 8000, the web client on 5173
just test        # every unit and integration suite
just --list      # everything else
```

The API runs on Railway, Postgres on Neon, the web client on a Cloudflare
Worker, sign-in on Clerk, and errors go to Sentry. `docs/architecture.md`
says how they fit together.

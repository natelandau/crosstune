# Crosstune hosting reference

This page records what each hosted service holds, because those settings
live in the hosts and nowhere in the code. Railway's `railway.json` config
files are deprecated, and a service created after 2026-08-28 cannot use
them, so the dashboards are the source of truth. For how the systems fit
together, read `architecture.md`. For the order to rebuild the hosts from
nothing, read `operations.md`.

Values pass between hosts as follows.

| Value                                                       | Produced by    | Consumed by                          |
| ----------------------------------------------------------- | -------------- | ------------------------------------ |
| Neon production and development connection strings          | Neon           | Railway                              |
| Neon development project ID and database role               | Neon           | GitHub                               |
| `crosstune-api` and `crosstune-web` DSNs                    | Sentry         | Railway, Workers Builds              |
| Clerk development issuer, publishable key, and secret key   | Clerk          | Railway, Workers Builds, GitHub      |
| Clerk production issuer and publishable key                 | Clerk          | Railway, Workers Builds              |
| Clerk webhook signing secrets, one per instance             | Clerk          | Railway                              |
| Railway development hostname                                | Railway        | Clerk webhooks, `web/wrangler.jsonc` |
| Railway project, development environment, and service IDs   | Railway        | GitHub                               |
| `workers.dev` subdomain                                     | Cloudflare     | Railway development regex            |
| KV namespace ID                                             | Cloudflare     | `web/wrangler.jsonc`, GitHub         |
| Cloudflare account ID                                       | Cloudflare     | GitHub, Railway                      |
| R2 access key ID and secret access key, one pair per bucket | Cloudflare     | Railway                              |
| CNAME targets for `api.<domain>` and the Clerk hostnames    | Railway, Clerk | Cloudflare DNS                       |

## Neon

Two projects, `crosstune-production` and `crosstune-development`, both in
AWS US East (N. Virginia), the metro that matches Railway's US East region.
Each holds one database named `crosstune`. The API reads the database name
from the connection string, so any name works.

Railway receives each project's connection string with connection pooling
off. The hostname must not contain `-pooler`. The string goes in as Neon
prints it. The API rewrites `sslmode` to the form asyncpg accepts and drops
`channel_binding`.

Object storage, functions, the AI gateway, and Neon Auth are off. Clerk owns
authentication, and audio storage is Cloudflare R2.

## Sentry

Two projects, `crosstune-api` on the Python FastAPI platform and
`crosstune-web` on the React platform. Only error monitoring is in use. The
API sets its trace sample rate to zero. The web client configures no replay,
tracing, logging, or metrics integration. The other Sentry products receive
nothing until the code changes.

The GitHub repository is connected for stack trace links, with the root
directory `api/` on the API project and `web/` on the web project. Suspect
commits stay empty, because nothing associates a release with commits, and
the web build emits no source maps.

## Clerk

One application with two instances. The development instance runs on
`https://<slug>.clerk.accounts.dev` with `pk_test_` and `sk_test_` keys. The
production instance is a clone of it with the home URL `https://<domain>`,
the issuer `https://clerk.<domain>`, and a `pk_live_` key. Its public keys
are at `https://clerk.<domain>/.well-known/jwks.json`.

The production instance needs five CNAME records in Cloudflare DNS, named
`clerk`, `accounts`, `clkmail`, `clk._domainkey`, and `clk2._domainkey`.
Each record has the proxy off, because Clerk's validation fails behind it.
Clerk issues certificates for those hostnames from the Home page of the
production instance, after every task on that page is done. Social sign-in
in production uses your own Google and Apple OAuth credentials, because a
production instance refuses Clerk's shared ones.

> **Note:** If certificate issuance hangs, look for CAA records on the domain
> that exclude Let's Encrypt or Google Trust Services.

Each instance has one webhook endpoint subscribed to `user.deleted` only.
The production endpoint is `https://api.<domain>/v1/webhooks/clerk`. The
development endpoint is the Railway development hostname with the same path.
Each endpoint's signing secret is `CROSSTUNE_CLERK_WEBHOOK_SECRET` in the
matching Railway environment.

## Railway

One project, `crosstune`, with one service, `api`, in the US East (Virginia)
region, with two environments, `production` and `development`. Both deploy
from `main`.

> **Note:** Creating a project from a GitHub repository starts a build from
> the repository root, which has no Dockerfile. That first build fails. The
> service needs its settings, not a new project.

| Service setting     | Value                                            |
| ------------------- | ------------------------------------------------ |
| Root directory      | `api`                                            |
| Branch              | `main`                                           |
| Watch paths         | `/api/**`                                        |
| Pre-deploy command  | `alembic upgrade head`                           |
| Healthcheck path    | `/healthz`                                       |
| Healthcheck timeout | 300 seconds, the default                         |
| Replicas            | 1, the default                                   |
| Restart policy      | On failure, ten retries, the default             |
| Wait for CI         | On, in both environments                         |
| Production domain   | `api.<domain>`, a CNAME in Cloudflare, proxy off |
| Development domain  | Generated by Railway                             |

Railway detects the Dockerfile in the root directory on its own and injects
`PORT`, which the container reads. Wait for CI holds a deploy until the
GitHub workflows for that commit pass. The pre-deploy command runs from the
image's working directory, where `alembic.ini` sits, with the service
variables, so it reaches the database the same way the API does.

A pull request environment is a third kind, named `pr-<number>`. The `Preview`
workflow creates it with the Railway CLI, as a copy of `development`, on the
first run that finds it missing, then overrides two variables and one
setting: `CROSSTUNE_DATABASE_URL` is the Neon branch's direct connection
string, `CROSSTUNE_ENVIRONMENT` is `pr-<number>`, and the service's branch is
the PR branch. Railway generates a public domain for it, and the workflow
reads that domain back. The workflow deletes the environment when the PR
closes. The account token it uses must belong to an account without
two-factor authentication, because the CLI cannot answer the prompt and the
delete hangs.

Production variables:

| Variable                             | Value                                       |
| ------------------------------------ | ------------------------------------------- |
| `CROSSTUNE_ENVIRONMENT`              | `production`                                |
| `CROSSTUNE_DEBUG`                    | `false`                                     |
| `CROSSTUNE_DATABASE_URL`             | Neon production string, as printed          |
| `CROSSTUNE_CLERK_ISSUER`             | `https://clerk.<domain>`                    |
| `CROSSTUNE_CLERK_AUTHORIZED_PARTIES` | `["https://<domain>"]`                      |
| `CROSSTUNE_CLERK_WEBHOOK_SECRET`     | Production endpoint signing secret          |
| `CROSSTUNE_SENTRY_DSN`               | `crosstune-api` DSN                         |
| `CROSSTUNE_R2_ACCOUNT_ID`            | Cloudflare account ID                       |
| `CROSSTUNE_R2_BUCKET`                | `crosstune-recordings`                      |
| `CROSSTUNE_R2_ACCESS_KEY_ID`         | Production bucket's API token access key ID |
| `CROSSTUNE_R2_SECRET_ACCESS_KEY`     | Production bucket's API token secret        |
| `CROSSTUNE_RECORDING_QUOTA_BYTES`    | Optional. Default `1073741824`              |
| `CROSSTUNE_RECORDING_MAX_FILE_BYTES` | Optional. Default `52428800`                |
| `CROSSTUNE_JOB_POLL_SECONDS`         | Optional. Default `3.0`                     |
| `CROSSTUNE_ORPHAN_SWEEP_SECONDS`     | Optional. Default `3600.0`                  |

Development variables:

| Variable                                 | Value                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `CROSSTUNE_ENVIRONMENT`                  | `development`                                                           |
| `CROSSTUNE_DEBUG`                        | `false`                                                                 |
| `CROSSTUNE_DATABASE_URL`                 | Neon development string, as printed                                     |
| `CROSSTUNE_CLERK_ISSUER`                 | `https://<slug>.clerk.accounts.dev`                                     |
| `CROSSTUNE_CLERK_AUTHORIZED_PARTIES`     | `["http://localhost:5173","http://localhost:4173"]`                     |
| `CROSSTUNE_CLERK_AUTHORIZED_PARTY_REGEX` | `^https://[a-z0-9-]+-crosstune-web\.<workers-subdomain>\.workers\.dev$` |
| `CROSSTUNE_CLERK_WEBHOOK_SECRET`         | Development endpoint signing secret                                     |
| `CROSSTUNE_SENTRY_DSN`                   | `crosstune-api` DSN                                                     |
| `CROSSTUNE_R2_ACCOUNT_ID`                | Cloudflare account ID                                                   |
| `CROSSTUNE_R2_BUCKET`                    | `crosstune-recordings-dev`                                              |
| `CROSSTUNE_R2_ACCESS_KEY_ID`             | Development bucket's API token access key ID                            |
| `CROSSTUNE_R2_SECRET_ACCESS_KEY`         | Development bucket's API token secret                                   |
| `CROSSTUNE_RECORDING_QUOTA_BYTES`        | Optional. Default `1073741824`                                          |
| `CROSSTUNE_RECORDING_MAX_FILE_BYTES`     | Optional. Default `52428800`                                            |
| `CROSSTUNE_JOB_POLL_SECONDS`             | Optional. Default `3.0`                                                 |
| `CROSSTUNE_ORPHAN_SWEEP_SECONDS`         | Optional. Default `3600.0`                                              |

A pull request environment inherits the development variables from the copy,
so it uses the `crosstune-recordings-dev` bucket too.

The regex writes the account's `workers.dev` subdomain literally. A subdomain
of `acme` gives `^https://[a-z0-9-]+-crosstune-web\.acme\.workers\.dev$`. It
admits every preview alias and every version preview of the Worker, and a PR
environment inherits it from the copy.

## Cloudflare Workers

One Worker, `crosstune-web`, connected to the GitHub repository through
Workers Builds with the production branch `main`. The configuration that
Cloudflare reads from the repository is `web/wrangler.jsonc`: the entry point
`worker/index.ts`, the assets directory `dist` with the single-page fallback
and `run_worker_first` limited to `/v1/*`, the custom domain route, the KV
binding `PREVIEW_API_ORIGINS`, and three runtime variables, `WORKER_NAME`,
`API_ORIGIN_PRODUCTION`, and `API_ORIGIN_DEVELOPMENT`. The product domain and
the Railway development hostname are literal in that file because the runtime
needs them and both are public in DNS already.

`workers_dev` is off and `preview_urls` is on. The bare
`crosstune-web.<workers-subdomain>.workers.dev` hostname serves nothing, and
every non-production version gets a preview URL. The deploy command for a
non-production branch passes `--preview-alias` with the slug that
`web/scripts/branch-slug.mjs` prints, so a branch has one stable URL across
pushes: `https://<alias>-crosstune-web.<workers-subdomain>.workers.dev`.
Cloudflare keeps the newest thousand aliases. Nothing retires them.

| Build setting                        | Value                 |
| ------------------------------------ | --------------------- |
| Root directory                       | `web`                 |
| Build command                        | `pnpm build:hosted`   |
| Deploy command                       | `npx wrangler deploy` |
| Non-production branch deploy command | `pnpm deploy:preview` |
| Build watch paths                    | `web/*`               |
| Builds for non-production branches   | On                    |

Build variables, shared by every branch:

| Variable                            | Value               |
| ----------------------------------- | ------------------- |
| `CLERK_PUBLISHABLE_KEY_PRODUCTION`  | `pk_live_...`       |
| `CLERK_PUBLISHABLE_KEY_DEVELOPMENT` | `pk_test_...`       |
| `VITE_SENTRY_DSN`                   | `crosstune-web` DSN |
| `PNPM_VERSION`                      | `12.4.1`            |

`web/scripts/hosted-build.sh` picks the Clerk key and sets
`VITE_SENTRY_ENVIRONMENT` from the branch: `main` gets the production key and
`production`, every other branch the development key and `development`.
Workers Builds reads the Node version from `web/.node-version`. It ignores
the `packageManager` field, so `PNPM_VERSION` must match it. A stale value
fails the next build on the lockfile version.

The KV namespace `crosstune-preview-api` holds one key per preview alias whose
value is the pull request's API origin, `https://<railway hostname>`. The
`Preview` workflow writes and deletes the keys with `wrangler kv key`. The
Worker reads them at request time. A missing key means the development API.

On the Worker's Domains tab, the Worker URL rows carry two toggles. The
production `workers.dev` toggle is off and the preview toggle is on. A branch
upload never changes them, and previews return a 404 while the preview
toggle is off. The custom domain `<domain>` is attached on the same tab and
Cloudflare manages its DNS record and certificate. The Clerk production
instance is bound to that domain. `web/public/_headers` ships in the assets
directory and sets `X-Content-Type-Options`, `X-Frame-Options`, and
`Referrer-Policy` on every response, plus `no-cache` on the service worker and
the manifest.

The API token the workflow uses has one permission, Workers KV Storage Edit,
on this account only.

## Cloudflare R2

Two buckets, `crosstune-recordings` for production and
`crosstune-recordings-dev` for development, pull request environments, and
local work. The API signs upload and download URLs, and it does a HEAD
check, a copy, and a delete for cleanup. The browser sends the file straight
to R2 with the signed PUT and plays it back with the signed GET.

| Bucket setting  | Value                                                        |
| --------------- | ------------------------------------------------------------ |
| Location hint   | Eastern North America (ENAM), the metro Railway and Neon use |
| API token scope | Object Read & Write, on that bucket alone                    |
| CORS methods    | `GET`, `PUT`, `HEAD`                                         |
| CORS headers    | Allowed: `Content-Type`. Exposed: `ETag`.                    |
| CORS max age    | 3600 seconds                                                 |

Each bucket has its own token. Railway holds a token's access key ID and
secret in `CROSSTUNE_R2_ACCESS_KEY_ID` and `CROSSTUNE_R2_SECRET_ACCESS_KEY`,
next to `CROSSTUNE_R2_ACCOUNT_ID` and `CROSSTUNE_R2_BUCKET`. The Railway
variable tables above list both environments.

The production bucket's CORS policy allows only the production web origin.

```json
[
  {
    "AllowedOrigins": ["https://<domain>"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

The development bucket's CORS policy allows the local Vite server, the
stable development preview, and every pull request preview.

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "http://localhost:4173",
      "https://development-crosstune-web.<workers-subdomain>.workers.dev",
      "https://*-crosstune-web.<workers-subdomain>.workers.dev"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

The Cloudflare account has a billing notification for R2 usage.

## Cloudflare zone

The zone for `<domain>` holds the DNS records for the Worker, the API, and
Clerk.
Every record that Railway or Clerk validates has the proxy off. Under
SSL/TLS, Always Use HTTPS is on and the encryption mode is Full (strict).
HTTP Strict Transport Security is on with these settings: a max age of six
months, applied to subdomains, preload off, and the no-sniff header on. The
`_headers` file cannot set HSTS, which is why it is a zone setting.

Cloudflare injects the HSTS header only on proxied hostnames, which here is
the apex alone. Browsers apply the subdomain rule from the apex visit, so
`api.<domain>` and the Clerk hostnames inherit the policy. A subdomain that
later drops HTTPS is unreachable until the max age expires.

## GitHub

Actions variables:

| Variable                     | Value                                         |
| ---------------------------- | --------------------------------------------- |
| `PRODUCTION_API_ORIGIN`      | `https://api.<domain>`                        |
| `PRODUCTION_WEB_ORIGIN`      | `https://<domain>`                            |
| `CLERK_ISSUER`               | The development issuer                        |
| `NEON_PROJECT_ID`            | The `crosstune-development` project ID        |
| `NEON_DATABASE_ROLE`         | The role in the development connection string |
| `RAILWAY_PROJECT_ID`         | The `crosstune` project ID                    |
| `RAILWAY_DEV_ENVIRONMENT_ID` | The `development` environment ID              |
| `RAILWAY_API_SERVICE_ID`     | The `api` service ID                          |
| `CLOUDFLARE_ACCOUNT_ID`      | The account ID                                |
| `CLOUDFLARE_KV_NAMESPACE_ID` | The `crosstune-preview-api` namespace ID      |

Actions secrets:

| Secret                       | Used by   | Value                                                       |
| ---------------------------- | --------- | ----------------------------------------------------------- |
| `CLERK_SECRET_KEY`           | `E2E`     | The development instance's `sk_test_...` key                |
| `VITE_CLERK_PUBLISHABLE_KEY` | `E2E`     | The development instance's `pk_test_...` key                |
| `E2E_CLERK_USER_EMAIL`       | `E2E`     | The email of a user that exists in the development instance |
| `NEON_API_KEY`               | `Preview` | A Neon API key                                              |
| `RAILWAY_API_TOKEN`          | `Preview` | A Railway account token, not a project token                |
| `CLOUDFLARE_API_TOKEN`       | `Preview` | The KV-only token described under Cloudflare Workers        |

The repository allows only squash merges, with the pull request title and
body as the commit message, and deletes head branches after merge. A branch
ruleset named `main` requires a pull request, the five workflow jobs as
status checks, and linear history. It blocks force pushes and deletion.
GitHub enforces rulesets on private repositories only on paid plans. On the
free plan the ruleset exists and does nothing, and not pushing to `main` is a
matter of habit.

> **Note:** Before enforcement is turned on, remove the `paths` filter from
> the `pull_request` trigger in both workflows. A required check that never
> starts blocks the merge.

# Crosstune hosting reference

What each hosted service holds and how the app reads it. These settings
live in dashboards and nowhere in the code, so this page is the record.
Railway's `railway.json` is deprecated for services created after
2026-08-28, so its dashboard is the only source. How the systems fit
together is in `architecture.md`. Deploys and the rebuild order are in
`operations.md`.

## How each deployable reads its settings

| Deployable     | Reads                                                      | From                                                                                             |
| -------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| API            | `CROSSTUNE_*` environment variables, via pydantic-settings | Railway service variables. Locally `api/.env`. Names and defaults: `api/src/crosstune/config.py` |
| Web client     | `VITE_*` variables at build time                           | Workers Builds variables through `web/scripts/hosted-build.sh`. Locally `web/.env`               |
| Worker         | `vars` and the KV binding                                  | `web/wrangler.jsonc`, in the repository                                                          |
| GitHub Actions | `vars.*` and `secrets.*`                                   | Repository settings                                                                              |

## Values that cross hosts

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
| R2 access key ID and secret access key, one pair per token  | Cloudflare     | Railway, GitHub                      |
| CNAME targets for `api.<domain>` and the Clerk hostnames    | Railway, Clerk | Cloudflare DNS                       |

## Neon

- Two projects, `crosstune-production` and `crosstune-development`, in AWS
  US East (N. Virginia), the metro Railway's US East region uses.
- Each holds one database named `crosstune`. The API reads the name from
  the connection string, so any name works.
- Railway gets each connection string with pooling off. The hostname must
  not contain `-pooler`. Alembic needs a direct connection. Paste the string
  as Neon prints it; the API rewrites `sslmode` and drops `channel_binding`.
- Object storage, functions, the AI gateway, and Neon Auth are off.

## Sentry

- Two projects: `crosstune-api` (Python FastAPI) and `crosstune-web`
  (React). Error monitoring only. The API's trace sample rate is zero and
  the web client configures no replay, tracing, logging, or metrics.
- The GitHub repository is connected for stack trace links, root directory
  `api/` on the API project and `web/` on the web project. Suspect commits
  stay empty because nothing associates a release with commits, and the web
  build emits no source maps.

## Clerk

- One application, two instances. Development runs on
  `https://<slug>.clerk.accounts.dev` with `pk_test_` and `sk_test_` keys.
  Production is a clone with home URL `https://<domain>`, issuer
  `https://clerk.<domain>`, and a `pk_live_` key.
- Production needs five CNAME records in Cloudflare DNS: `clerk`,
  `accounts`, `clkmail`, `clk._domainkey`, `clk2._domainkey`. Proxy off on
  each, because Clerk's validation fails behind it. Clerk issues the
  certificates from the production instance's Home page once every task
  there is done.
- Production social sign-in uses your own Google and Apple OAuth
  credentials. A production instance refuses Clerk's shared ones.
- Each instance has one webhook endpoint subscribed to `user.deleted` only.
  Production: `https://api.<domain>/v1/webhooks/clerk`. Development: the
  Railway development hostname with the same path. Each endpoint's signing
  secret is `CROSSTUNE_CLERK_WEBHOOK_SECRET` in the matching Railway
  environment.

> **Note:** If certificate issuance hangs, look for CAA records on the
> domain that exclude Let's Encrypt or Google Trust Services.

## Railway

One project, `crosstune`, one service, `api`, region US East (Virginia),
environments `production` and `development`.

> **Note:** Creating a project from the repository starts a build from the
> root, which has no Dockerfile, and that first build fails. Set the service
> settings; do not create a new project.

| Service setting     | Value                                             |
| ------------------- | ------------------------------------------------- |
| Root directory      | `api`                                             |
| Branch              | `production` in production, `main` in development |
| Watch paths         | `/api/**`                                         |
| Pre-deploy command  | `alembic upgrade head`                            |
| Healthcheck path    | `/healthz`                                        |
| Healthcheck timeout | 300 seconds, the default                          |
| Replicas            | 1, the default                                    |
| Restart policy      | On failure, ten retries, the default              |
| Wait for CI         | On in development, off in production              |
| Production domain   | `api.<domain>`, a CNAME in Cloudflare, proxy off  |
| Development domain  | Generated by Railway                              |

- Railway detects the Dockerfile and injects `PORT`.
- The pre-deploy command runs from the image's working directory with the
  service variables, so it reaches the database the way the API does.
- A pull request environment `pr-<number>` is a copy of `development` that
  the `Preview` workflow creates with the Railway CLI, with seven overrides:
  `CROSSTUNE_DATABASE_URL` is the Neon branch's direct string,
  `CROSSTUNE_ENVIRONMENT` is `pr-<number>`, the service branch is the PR
  branch, `CROSSTUNE_R2_BUCKET` is `crosstune-recordings-preview`,
  `CROSSTUNE_R2_ACCESS_KEY_ID` and `CROSSTUNE_R2_SECRET_ACCESS_KEY` are the
  preview token's values, and `CROSSTUNE_R2_PREFIX` is `pr-<number>/`. The
  workflow sets them on every run and deletes the environment when the PR
  closes.
- The account token the workflow uses must belong to an account without
  two-factor authentication. The CLI cannot answer the prompt and the
  delete hangs.

Variables, both environments unless noted:

| Variable                                 | Production                         | Development                                                             |
| ---------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| `CROSSTUNE_ENVIRONMENT`                  | `production`                       | `development`                                                           |
| `CROSSTUNE_DEBUG`                        | `false`                            | `false`                                                                 |
| `CROSSTUNE_DATABASE_URL`                 | Neon production string, as printed | Neon development string, as printed                                     |
| `CROSSTUNE_CLERK_ISSUER`                 | `https://clerk.<domain>`           | `https://<slug>.clerk.accounts.dev`                                     |
| `CROSSTUNE_CLERK_AUTHORIZED_PARTIES`     | `["https://<domain>"]`             | `["http://localhost:5173","http://localhost:4173"]`                     |
| `CROSSTUNE_CLERK_AUTHORIZED_PARTY_REGEX` | Unset                              | `^https://[a-z0-9-]+-crosstune-web\.<workers-subdomain>\.workers\.dev$` |
| `CROSSTUNE_CLERK_WEBHOOK_SECRET`         | Production endpoint secret         | Development endpoint secret                                             |
| `CROSSTUNE_SENTRY_DSN`                   | `crosstune-api` DSN                | `crosstune-api` DSN                                                     |
| `CROSSTUNE_R2_ACCOUNT_ID`                | Cloudflare account ID              | Cloudflare account ID                                                   |
| `CROSSTUNE_R2_BUCKET`                    | `crosstune-recordings`             | `crosstune-recordings-dev`                                              |
| `CROSSTUNE_R2_ACCESS_KEY_ID`             | Production bucket token key ID     | Development bucket token key ID                                         |
| `CROSSTUNE_R2_SECRET_ACCESS_KEY`         | Production bucket token secret     | Development bucket token secret                                         |
| `CROSSTUNE_R2_PREFIX`                    | Unset                               | Unset                                                                    |

Quota, file size, job polling, sweep, resolver timeout, link resolve rate
limit, and pull page size keep the defaults in `api/src/crosstune/config.py`
and are not set on the host. The regex
writes the `workers.dev` subdomain literally and admits every preview alias.
The API refuses to start when `CROSSTUNE_R2_PREFIX`, `CROSSTUNE_R2_BUCKET`,
and `CROSSTUNE_ENVIRONMENT` disagree: production and development take no
prefix, a `pr-<number>` environment must set the prefix to `pr-<number>/`
and the bucket to `crosstune-recordings-preview`, and no other environment
may use that bucket. The guard is in `api/src/crosstune/config.py`.

## Cloudflare Workers

One Worker, `crosstune-web`, connected to the repository through Workers
Builds with production branch `production`. `web/wrangler.jsonc` holds the
entry point, the assets directory with the single-page fallback and
`run_worker_first` for `/v1/*`, the custom domain route, the KV binding
`PREVIEW_API_ORIGINS`, and the three runtime variables. The product domain
and the Railway development hostname are literal there because both are
public in DNS.

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

- `web/scripts/hosted-build.sh` picks the Clerk key and sets
  `VITE_SENTRY_ENVIRONMENT` by branch: `production` gets the production key,
  every other branch the development key.
- Workers Builds reads Node from `web/.node-version` and ignores
  `packageManager`, so `PNPM_VERSION` must match it or the next build fails
  on the lockfile version.
- `workers_dev` is off and `preview_urls` is on. The bare
  `crosstune-web.<workers-subdomain>.workers.dev` serves nothing. A
  non-production branch deploys with `--preview-alias` set to the slug from
  `web/scripts/branch-slug.mjs`, giving one stable URL per branch:
  `https://<alias>-crosstune-web.<workers-subdomain>.workers.dev`. `main` is
  such a branch, and its alias is the development environment. Cloudflare
  keeps the newest thousand aliases.
- On the Worker's Domains tab, the production `workers.dev` toggle is off
  and the preview toggle is on. Previews return 404 while the preview toggle
  is off. The custom domain `<domain>` is attached there and Cloudflare
  manages its record and certificate.
- The KV namespace `crosstune-preview-api` maps a preview alias to a pull
  request's API origin. The `Preview` workflow writes and deletes keys; the
  Worker reads them per request. A missing key means the development API.
- The API token the workflow uses has one permission, Workers KV Storage
  Edit, on this account only.
- `web/public/_headers` ships in the assets directory: security headers on
  every response, `no-cache` on the service worker and manifest, a year of
  immutable caching on hashed assets.

## Cloudflare R2

Three buckets: `crosstune-recordings` for production,
`crosstune-recordings-dev` for development, and
`crosstune-recordings-preview` for pull requests, each `pr-<n>/` prefix
owned by one pull request. No bucket serves local work. Local recordings
stay in the RustFS container `docker compose` starts.

| Bucket setting        | Value                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Location hint         | Eastern North America (ENAM), the metro the others use                                                                |
| Default storage class | Standard                                                                                                               |
| Lifecycle rules       | None on production and development. Preview: delete objects 90 days after upload.                                     |
| API token scope       | Object Read & Write, on that bucket alone, except the development read-only token below                              |
| CORS methods          | `GET`, `PUT`, `HEAD`                                                                                                   |
| CORS headers          | Allowed `Content-Type`. Exposed `ETag`.                                                                                |
| CORS max age          | 3600 seconds                                                                                                          |
| CORS origins          | Production: `https://<domain>`. Development and preview: `https://*-crosstune-web.<workers-subdomain>.workers.dev` |

- Every object stays in Standard storage. Never set Infrequent Access as a
  default, add a lifecycle rule that transitions to it, or pass a storage
  class from the API. `decisions.md` has the cost reason. An object found
  outside Standard moves back with an S3 `CopyObject` onto its own key with
  the `STANDARD` class; a lifecycle rule cannot.
- Four tokens: production read-write, held in Railway's `production`
  environment; development read-write, held in Railway's `development`
  environment; development read-only, held in the GitHub secret pair
  `R2_DEV_READ_ACCESS_KEY_ID` and `R2_DEV_READ_SECRET_ACCESS_KEY`, used to
  seed a preview from development; preview read-write, held in the GitHub
  secret pair `R2_PREVIEW_ACCESS_KEY_ID` and `R2_PREVIEW_SECRET_ACCESS_KEY`,
  and set on each `pr-<n>` Railway environment by the `Preview` workflow.
- The account has a billing notification for R2 usage.

## Cloudflare zone

- The zone for `<domain>` holds the records for the Worker, the API, and
  Clerk. Every record that Railway or Clerk validates has the proxy off.
- SSL/TLS: Always Use HTTPS on, encryption mode Full (strict).
- HSTS on: max age six months, applied to subdomains, preload off, no-sniff
  on. `_headers` cannot set HSTS, which is why it is a zone setting.
- Cloudflare injects HSTS only on proxied hostnames, which is the apex
  alone. Browsers apply the subdomain rule from the apex visit, so
  `api.<domain>` and the Clerk hostnames inherit it. A subdomain that drops
  HTTPS is unreachable until the max age expires.

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

| Secret                       | Used by   | Value                                                |
| ---------------------------- | --------- | ---------------------------------------------------- |
| `CLERK_SECRET_KEY`           | `E2E`     | The development instance's `sk_test_...` key         |
| `VITE_CLERK_PUBLISHABLE_KEY` | `E2E`     | The development instance's `pk_test_...` key         |
| `E2E_CLERK_USER_EMAIL`       | `E2E`     | The email of a user in the development instance      |
| `NEON_API_KEY`               | `Preview` | A Neon API key                                       |
| `RAILWAY_API_TOKEN`          | `Preview` | A Railway account token, not a project token         |
| `CLOUDFLARE_API_TOKEN`       | `Preview` | The KV-only token described under Cloudflare Workers |
| `R2_PREVIEW_ACCESS_KEY_ID`   | `Preview` | The preview bucket token's access key ID             |
| `R2_PREVIEW_SECRET_ACCESS_KEY` | `Preview` | The preview bucket token's secret access key       |
| `R2_DEV_READ_ACCESS_KEY_ID`  | `Preview` | The development bucket's read-only token's access key ID |
| `R2_DEV_READ_SECRET_ACCESS_KEY` | `Preview` | The development bucket's read-only token's secret access key |

- Squash merges only, with the PR title and body as the commit message.
  Head branches are deleted after merge.
- A ruleset named `main` requires a pull request, the five workflow jobs as
  status checks, and linear history, and blocks force pushes and deletion.
  GitHub enforces rulesets on private repositories only on paid plans, so on
  the free plan it exists and does nothing.

> **Note:** Before turning enforcement on, remove the `paths` filter from
> the `pull_request` trigger in both workflows. A required check that never
> starts blocks the merge.

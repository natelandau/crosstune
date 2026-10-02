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
| Site           | `PUBLIC_CLERK_PUBLISHABLE_KEY` at build time               | Workers Builds variables through `site/scripts/hosted-build.sh`. Locally `site/.env`             |
| GitHub Actions | `vars.*` and `secrets.*`                                   | Repository settings                                                                              |

## Naming a variable

- Every name the code reads is in `api/.env.example`, `web/.env.example`,
  or `site/.env.example` with its explanation, names only a host sets
  included.
- `LOCAL_`, in the API `CROSSTUNE_LOCAL_`, marks a name that only local work
  and the end-to-end suite set. `E2E_` marks an end-to-end credential.
- `STORAGE_` names a setting of any S3-compatible store. `R2_` names only a
  value that exists on R2 alone.
- An environment qualifier comes last and is spelled out: `_PRODUCTION`,
  `_DEVELOPMENT`, `_PREVIEW`.
- A GitHub variable or secret that feeds one app variable has that
  variable's name.

## Values that cross hosts

| Value                                                      | Produced by       | Consumed by                          |
| ---------------------------------------------------------- | ----------------- | ------------------------------------ |
| Neon production and development connection strings         | Neon              | Railway                              |
| Neon development project ID and database role              | Neon              | GitHub                               |
| `crosstune-api` and `crosstune-web` DSNs                   | Sentry            | Railway, Workers Builds              |
| Clerk development issuer, publishable key, and secret key  | Clerk             | Railway, Workers Builds, GitHub      |
| Clerk production issuer, publishable key, and secret key   | Clerk             | Railway, Workers Builds              |
| Clerk webhook signing secrets, one per instance            | Clerk             | Railway                              |
| Railway development hostname                               | Railway           | Clerk webhooks, `web/wrangler.jsonc` |
| Railway project, development environment, and service IDs  | Railway           | GitHub                               |
| `workers.dev` subdomain                                    | Cloudflare        | Railway development regex            |
| KV namespace ID                                            | Cloudflare        | `web/wrangler.jsonc`, GitHub         |
| Cloudflare account ID                                      | Cloudflare        | GitHub, Railway                      |
| R2 access key ID and secret access key, one pair per token | Cloudflare        | Railway, GitHub                      |
| CNAME targets for `api.<domain>` and the Clerk hostnames   | Railway, Clerk    | Cloudflare DNS                       |
| App Store Connect API key, key ID, and issuer ID           | App Store Connect | GitHub, `apple/.env`                 |
| Apple Development certificate and its `.p12` password      | Apple Developer   | GitHub                               |

## Neon

- Two projects, `crosstune-production` and `crosstune-development`, in AWS
  US East (N. Virginia), the metro Railway's US East region uses.
- Each holds one database named `crosstune`. The API reads the name from
  the connection string, so any name works.
- Railway gets each connection string with pooling off. The hostname must
  not contain `-pooler`. Alembic needs a direct connection. Paste the string
  as Neon prints it; the API rewrites `sslmode` and drops `channel_binding`.
- Object storage, functions, the AI gateway, and Neon Auth are off.
- Scale to zero is on, after 5 minutes, in both projects.
- Development: the `production` branch compute and the project's compute
  defaults, which `pr-<n>` branches take, are a fixed 0.25 CU.
- Production: the `production` branch compute autoscales from 0.25 to 1 CU.

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

- Both instances offer an emailed verification code, Google, and Apple, and
  refuse passwords and email links. Users can delete their own accounts.
- Both instances are in Waitlist access mode. The Waitlist confirmation and
  invitation emails carry Crosstune copy. The web client sends visitors to
  `https://<domain>/waitlist`. The production Account Portal redirects
  fall back to `https://my.<domain>`.
- Both instances enable the Native API and list the Apple app on **Native
  applications**: App ID Prefix `N76T49G924`, Bundle ID
  `app.crosstune.Crosstune`. Production checks sign-in callbacks against
  it.
- The Apple app reads each instance's publishable key from
  `apple/Config/Debug.xcconfig` (development) and `Release.xcconfig`
  (production). Its tokens carry no `azp`, so
  `CROSSTUNE_CLERK_AUTHORIZED_PARTIES` lists browser origins only.

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
| Serverless          | On                                                |
| Production domain   | `api.<domain>`, a CNAME in Cloudflare, proxy off  |
| Development domain  | Generated by Railway                              |

- Railway detects the Dockerfile and injects `PORT`.
- The pre-deploy command runs from the image's working directory with the
  service variables, so it reaches the database the way the API does.
- A pull request environment `pr-<number>` is a copy of `development` that
  the `Preview` workflow creates with the Railway CLI, with seven overrides:
  `CROSSTUNE_DATABASE_URL` is the Neon branch's direct string,
  `CROSSTUNE_ENVIRONMENT` is `pr-<number>`, the service branch is the PR
  branch, `CROSSTUNE_STORAGE_BUCKET` is `crosstune-recordings-preview`,
  `CROSSTUNE_STORAGE_ACCESS_KEY_ID` and
  `CROSSTUNE_STORAGE_SECRET_ACCESS_KEY` are the preview token's values, and
  `CROSSTUNE_STORAGE_PREFIX` is `pr-<number>/`. The workflow sets them on
  every run and deletes the environment when the PR closes.
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
| `CROSSTUNE_CLERK_AUTHORIZED_PARTIES`     | `["https://my.<domain>"]`          | `["http://localhost:5173","http://localhost:4173"]`                     |
| `CROSSTUNE_CLERK_AUTHORIZED_PARTY_REGEX` | Unset                              | `^https://[a-z0-9-]+-crosstune-web\.<workers-subdomain>\.workers\.dev$` |
| `CROSSTUNE_CLERK_WEBHOOK_SECRET`         | Production endpoint secret         | Development endpoint secret                                             |
| `CROSSTUNE_CLERK_SECRET_KEY`             | Production instance's secret key   | Development instance's secret key                                       |
| `CROSSTUNE_SENTRY_DSN`                   | `crosstune-api` DSN                | `crosstune-api` DSN                                                     |
| `CROSSTUNE_R2_ACCOUNT_ID`                | Cloudflare account ID              | Cloudflare account ID                                                   |
| `CROSSTUNE_STORAGE_BUCKET`               | `crosstune-recordings`             | `crosstune-recordings-dev`                                              |
| `CROSSTUNE_STORAGE_ACCESS_KEY_ID`        | Production bucket token key ID     | Development bucket token key ID                                         |
| `CROSSTUNE_STORAGE_SECRET_ACCESS_KEY`    | Production bucket token secret     | Development bucket token secret                                         |
| `CROSSTUNE_STORAGE_PREFIX`               | Unset                              | Unset                                                                   |

Quota, file size, request body size, sweep, link resolve
timeout, link resolve rate limit, and pull page size keep the defaults in
`api/src/crosstune/config.py` and are not set on the host. The
`CROSSTUNE_LOCAL_*` names are for local work and the end-to-end suite, and
the API refuses to start with them on a hosted environment. Production and
every `pr-<n>` environment refuse to start without the Clerk issuer, a
secret key, and an authorized party or pattern. Railway injects
`PORT`. `api/.env.example` explains every name. The regex
writes the `workers.dev` subdomain literally and admits every preview alias.
The API refuses to start when `CROSSTUNE_STORAGE_PREFIX`,
`CROSSTUNE_STORAGE_BUCKET`, and `CROSSTUNE_ENVIRONMENT` disagree. The guard is in
`api/src/crosstune/config.py` and holds these rules:

- Production and development take no prefix.
- Production must use `crosstune-recordings`, and no other environment can
  use it.
- A `pr-<number>` environment must set the prefix to `pr-<number>/` and the
  bucket to `crosstune-recordings-preview`. No other environment can use
  that bucket.

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
| Preview command                      | `pnpm deploy:preview` |
| Build watch paths                    | `web/*`               |
| Builds for non-production branches   | On                    |

Build variables, set on both the production and the branch builds.
Workers Builds keeps a separate set for each, and a branch build never
sees the production set:

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
  and the **Version URLs** toggle is on. Previews return 404 while
  **Version URLs** is off. The custom domain `my.<domain>` is attached there
  and Cloudflare manages its record and certificate.
- The KV namespace `crosstune-preview-api` maps a preview alias to a pull
  request's API origin. The `Preview` workflow writes and deletes keys; the
  Worker reads them per request. A missing key means the development API.
- The API token the workflow uses has one permission, Workers KV Storage
  Edit, on this account only.
- `web/public/_headers` ships in the assets directory: security headers on
  every response, `no-cache` on the service worker and manifest, a year of
  immutable caching on hashed assets.

### The site Worker

A second Worker, `crosstune-site`, serves `https://<domain>` from `site/`.
It has no script: `site/wrangler.jsonc` holds the assets directory, the
custom domain route, and the same `workers_dev` off and `preview_urls` on
pair as `crosstune-web`. It has its own Workers Builds connection to the
repository.

| Build setting                      | Value                 |
| ---------------------------------- | --------------------- |
| Root directory                     | `site`                |
| Build command                      | `pnpm build:hosted`   |
| Deploy command                     | `npx wrangler deploy` |
| Preview command                    | `pnpm deploy:preview` |
| Build watch paths                  | `site/*`              |
| Production branch                  | `production`          |
| Builds for non-production branches | On                    |

Build variables, the same names and values as `crosstune-web`, on both
the production and the branch builds:

| Variable                            | Value         |
| ----------------------------------- | ------------- |
| `CLERK_PUBLISHABLE_KEY_PRODUCTION`  | `pk_live_...` |
| `CLERK_PUBLISHABLE_KEY_DEVELOPMENT` | `pk_test_...` |
| `PNPM_VERSION`                      | `12.4.1`      |

- Unlike `crosstune-web`, this Worker uses Cloudflare's Worker Previews.
  `pnpm deploy:preview` runs `wrangler preview`, which needs the `previews`
  block in `site/wrangler.jsonc`. Each branch gets a Preview named after it,
  with a stable Preview URL that Workers Builds posts on the pull request.
  `wrangler versions upload --preview-alias` fails on this Worker.
- `site/scripts/hosted-build.sh` exports `PUBLIC_CLERK_PUBLISHABLE_KEY` by
  branch, as the web build does. The site uses it for the waitlist form
  only.
- The Domains tab matches `crosstune-web`: the apex `<domain>` is attached
  as a custom domain, the production `workers.dev` toggle is off, and
  **Version URLs** is on.
- `site/public/_headers` sets security headers on every response and
  `no-cache` on `/sw.js`.

## Cloudflare R2

Three buckets: `crosstune-recordings` for production,
`crosstune-recordings-dev` for development, and
`crosstune-recordings-preview` for pull requests, each `pr-<n>/` prefix
owned by one pull request. No bucket serves local work. Local recordings
stay in the RustFS container `docker compose` starts.

| Bucket setting        | Value                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Location hint         | Eastern North America (ENAM), the metro the others use                                                                |
| Default storage class | Standard                                                                                                              |
| Lifecycle rules       | None on production and development. Preview: delete objects 90 days after upload.                                     |
| API token scope       | Object Read & Write, on that bucket alone, except the development read-only token below                               |
| CORS methods          | `GET`, `PUT`, `HEAD`                                                                                                  |
| CORS headers          | Allowed `Content-Type`. Exposed `ETag`.                                                                               |
| CORS max age          | 3600 seconds                                                                                                          |
| CORS origins          | Production: `https://my.<domain>`. Development and preview: `https://*-crosstune-web.<workers-subdomain>.workers.dev` |

- Every object stays in Standard storage. Never set Infrequent Access as a
  default, add a lifecycle rule that transitions to it, or pass a storage
  class from the API. `decisions.md` has the cost reason. An object found
  outside Standard moves back with an S3 `CopyObject` onto its own key with
  the `STANDARD` class; a lifecycle rule cannot.
- Four tokens: production read-write, held in Railway's `production`
  environment; development read-write, held in Railway's `development`
  environment; development read-only, held in the GitHub secret pair
  `STORAGE_READ_ACCESS_KEY_ID_DEVELOPMENT` and
  `STORAGE_READ_SECRET_ACCESS_KEY_DEVELOPMENT`, used to seed a preview from
  development; preview read-write, held in the GitHub secret pair
  `STORAGE_ACCESS_KEY_ID_PREVIEW` and `STORAGE_SECRET_ACCESS_KEY_PREVIEW`,
  and set on each `pr-<n>` Railway environment by the `Preview` workflow.
- The account has a billing notification for R2 usage.

## Cloudflare zone

- The zone for `<domain>` holds the records for the Worker, the API, and
  Clerk. Every record that Railway or Clerk validates has the proxy off.
- SSL/TLS: Always Use HTTPS on, encryption mode Full (strict).
- HSTS on: max age six months, applied to subdomains, preload off, no-sniff
  on. `_headers` cannot set HSTS, which is why it is a zone setting.
- Cloudflare injects HSTS only on proxied hostnames, which are the apex
  and `my.<domain>`. Browsers apply the subdomain rule from the apex visit,
  so `api.<domain>` and the Clerk hostnames inherit it. A subdomain that
  drops HTTPS is unreachable until the max age expires.
- Email Routing forwards `support@<domain>` to the maintainer's inbox. The
  MX and SPF/DKIM records it adds are locked to it.

## GitHub

Actions variables:

| Variable                             | Value                                         |
| ------------------------------------ | --------------------------------------------- |
| `API_ORIGIN_PRODUCTION`              | `https://api.<domain>`                        |
| `WEB_ORIGIN_PRODUCTION`              | `https://my.<domain>`                         |
| `SITE_ORIGIN_PRODUCTION`             | `https://<domain>`                            |
| `CROSSTUNE_CLERK_ISSUER`             | The development issuer                        |
| `NEON_PROJECT_ID`                    | The `crosstune-development` project ID        |
| `NEON_DATABASE_ROLE`                 | The role in the development connection string |
| `RAILWAY_PROJECT_ID`                 | The `crosstune` project ID                    |
| `RAILWAY_ENVIRONMENT_ID_DEVELOPMENT` | The `development` environment ID              |
| `RAILWAY_API_SERVICE_ID`             | The `api` service ID                          |
| `CLOUDFLARE_ACCOUNT_ID`              | The account ID                                |
| `CLOUDFLARE_KV_NAMESPACE_ID`         | The `crosstune-preview-api` namespace ID      |

Actions secrets:

| Secret                                       | Used by   | Value                                                                              |
| -------------------------------------------- | --------- | ---------------------------------------------------------------------------------- |
| `CLERK_SECRET_KEY`                           | `E2E`     | The development instance's `sk_test_...` key                                       |
| `VITE_CLERK_PUBLISHABLE_KEY`                 | `E2E`     | The development instance's `pk_test_...` key                                       |
| `E2E_CLERK_USER_EMAIL`                       | `E2E`     | The email of a user in the development instance                                    |
| `NEON_API_KEY`                               | `Preview` | A Neon API key                                                                     |
| `RAILWAY_API_TOKEN`                          | `Preview` | A Railway account token, not a project token                                       |
| `CLOUDFLARE_API_TOKEN`                       | `Preview` | The KV-only token described under Cloudflare Workers                               |
| `STORAGE_ACCESS_KEY_ID_PREVIEW`              | `Preview` | The preview bucket token's access key ID                                           |
| `STORAGE_SECRET_ACCESS_KEY_PREVIEW`          | `Preview` | The preview bucket token's secret access key                                       |
| `STORAGE_READ_ACCESS_KEY_ID_DEVELOPMENT`     | `Preview` | The development bucket's read-only token's access key ID                           |
| `STORAGE_READ_SECRET_ACCESS_KEY_DEVELOPMENT` | `Preview` | The development bucket's read-only token's secret access key                       |
| `ENVIRONMENTS_ADMIN_TOKEN`                   | `Preview` | A fine-grained token for this repository alone, with Administration read and write |

Environment `app-store`, used only by the `Release` workflow's **Archive
the Apple apps** and **Upload to TestFlight** jobs. Its deployment rule
admits tags matching `v*` only. It has no required reviewer, because each
job that uses it would wait for its own approval.

| Secret                           | Value                                                           |
| -------------------------------- | --------------------------------------------------------------- |
| `ASC_API_KEY_P8`                 | The full text of the App Store Connect API key's `.p8` file     |
| `ASC_API_KEY_ID`                 | That key's 10-character key ID                                  |
| `ASC_API_KEY_ISSUER_ID`          | The team's issuer ID                                            |
| `APPLE_DEVELOPMENT_P12`          | The Apple Development certificate and its key, as base64 `.p12` |
| `APPLE_DEVELOPMENT_P12_PASSWORD` | The `.p12` password                                             |

- Squash merges only, with the PR title and body as the commit message.
  Head branches are deleted after merge.
- A ruleset named `main`, enforced, requires a pull request, the five workflow
  jobs (`API lint`, `API test`, `API contract`, `Web check`, `Web contract`)
  as status checks, and linear history, and blocks force pushes and deletion.
  `Web check` is a gate job that passes when the web lint and test shards
  pass or skip, so the shards can change without editing the ruleset.

> **Note:** A required check that never starts blocks the merge, so the
> `API` and `Web` workflows have no `paths` filter on `pull_request`; their
> `changes` job skips the work instead. `Apple` stays out of the ruleset, so
> its filter stays.

## App Store Connect

- One app record, `Crosstune`, bundle ID `app.crosstune.Crosstune`, SKU
  `crosstune`, platforms iOS and macOS. The SKU and bundle ID are
  permanent.
- TestFlight internal group `Friends`, with automatic distribution on, so
  every processed build reaches it. Internal testers are App Store Connect
  users with the Marketing role and access to Crosstune only.
- One Team Key, under **Users and Access** > **Integrations** > **App Store
  Connect API**, with the Admin role. Cloud signing needs Admin, and a key's
  role cannot change, so a new role means a new key.
- Certificates, in the developer portal:
  - The maintainer's **Development** certificate signs the archive, from a
    Mac and from `APPLE_DEVELOPMENT_P12` in CI. It expires on 2027-06-05.
    Renew it in Xcode (**Settings** > **Accounts** > **Manage
    Certificates**) and export it again to the secret.
  - **Distribution Managed** and **Mac Installer Distribution Managed** are
    Apple's cloud signing certificates for uploads. Apple holds their keys.
    Leave them.
  - A **Development** certificate named **Created via API** means an
    archive ran without the development identity. Nothing can use it.
    Revoke it.

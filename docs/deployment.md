# Deploying Crosstune

Crosstune runs in two hosted environments, `production` and `development`, both
built from `main`. Production serves `https://<domain>`, the API at
`https://api.<domain>`, and Clerk's production instance. Development serves
Cloudflare Pages previews of every other branch, the API on a Railway-generated
domain, and the Clerk development instance.

## Prerequisites

- A domain that you own, with DNS hosted on Cloudflare. Clerk's production
  instances require a domain.
- Accounts on GitHub, Railway, Neon, Cloudflare, Clerk, and Sentry.
- The repository pushed to GitHub. Railway and Cloudflare Pages deploy from the
  GitHub repository, and there is no other deployment path.

  ```bash
  git remote add origin <url>
  git push -u origin main
  ```

- The values below. You collect each one while you work through the numbered
  sections, and later sections consume the values that earlier sections
  produce.

  | Value                                                          | Produced in section |
  | -------------------------------------------------------------- | ------------------- |
  | Neon production URL                                            | 1                   |
  | Neon development URL                                           | 1                   |
  | Sentry API DSN                                                 | 2                   |
  | Sentry web DSN                                                 | 2                   |
  | Clerk development issuer (`https://<slug>.clerk.accounts.dev`) | 3                   |
  | Clerk development publishable key (`pk_test_...`)              | 3                   |
  | Clerk production issuer (`https://clerk.<domain>`)             | 3                   |
  | Clerk production publishable key (`pk_live_...`)               | 3                   |
  | Clerk development secret key (`sk_test_...`)                   | 3                   |
  | Railway development domain                                     | 4                   |
  | Clerk production webhook secret                                | 3, after 4          |
  | Clerk development webhook secret                               | 3, after 4          |

## 1. Neon

1. Create a Neon project named `crosstune-production`. Choose region AWS US East
   (N. Virginia). Choose Postgres 18 if Neon offers it, or the newest version
   Neon offers otherwise.
2. Create a second project named `crosstune-development`, with the same region.

   > Use the same metro area as the Railway region you choose in section 4,
   > step 4. Railway's US East region is Virginia.

3. Copy each project's connection string with Connection pooling turned off.
   The hostname must not contain `-pooler`. Paste the string into Railway
   exactly as Neon prints it. The API rewrites `sslmode` and drops
   `channel_binding` itself. A direct connection matters because one API
   replica keeps its own connection pool, and Alembic needs a direct
   connection to run migrations.

   > Neon suspends compute when a project sits idle. The first request after a
   > pause takes a few seconds, and the API's connection pre-ping reconnects
   > automatically.

## 2. Sentry

1. Create a Sentry project named `crosstune-api`, platform Python (FastAPI).
2. Create a second project named `crosstune-web`, platform React.
3. Copy each project's DSN.

Both the production and development environments report to both projects.
Sentry tags each event `production` or `development`.

## 3. Clerk

1. Note the existing development instance's issuer, the Frontend API URL
   `https://<slug>.clerk.accounts.dev`, its publishable key, and its secret
   key (`sk_test_...`). Crosstune's development environment uses this
   instance, and section 6 needs the secret key.
2. In the Clerk dashboard, click **Create production instance** and clone it
   from the development instance. Set the home URL to `https://<domain>`.
3. On the **Domains** page, add every DNS record that Clerk lists (`clerk`,
   `accounts`, `clkmail`, `clk._domainkey`, `clk2._domainkey`) to Cloudflare
   DNS. Turn the proxy off for each record (DNS only, grey cloud). Clerk's
   validation fails behind the proxy.
4. Wait for all records to verify, then click **Deploy certificates**.
5. To enable social sign-in in production, add your own OAuth credentials: a
   Google Cloud OAuth client for Google, and an Apple Developer Services ID,
   Team ID, Key ID, and private key for Apple. Email magic link works once the
   email DNS records verify. Enable the same sign-in methods as development.
6. Confirm the production issuer, `https://clerk.<domain>`, with:

   ```bash
   curl https://clerk.<domain>/.well-known/jwks.json
   ```

   The production publishable key is `pk_live_...`.

7. After section 4, step 8 gives you the API domains, add a webhook endpoint
   to each Clerk instance:

   - Production: URL `https://api.<domain>/v1/webhooks/clerk`
   - Development: URL `https://<railway-dev-domain>/v1/webhooks/clerk`

   For each endpoint, select only the `user.deleted` event. Copy the signing
   secret (`whsec_...`) into the matching Railway environment as
   `CROSSTUNE_CLERK_WEBHOOK_SECRET`.

8. The API checks the token's `azp` claim against
   `CROSSTUNE_CLERK_AUTHORIZED_PARTIES` (an exact match) and
   `CROSSTUNE_CLERK_AUTHORIZED_PARTY_REGEX`. Production lists
   `https://<domain>`. Development lists the local origins and the preview
   regex.

## 4. Railway

1. Create a Railway project named `crosstune` from the GitHub repository, and
   add a service named `api`.
2. In the service settings, set the root directory to `api`, the config file
   path to `/api/railway.json` (Railway does not look under the root
   directory for it), and the branch to `main`. Railway reads the build and
   deploy settings from `api/railway.json`: the Dockerfile builder, watch
   paths under `api/`, the `/healthz` healthcheck with a 300 second timeout,
   one replica, and a restart on failure.
3. Migrations run from the container's CMD before uvicorn starts. This is
   safe with one replica. Before you add a second replica, move the
   migration to a Railway pre-deploy command (`preDeployCommand` in
   `api/railway.json`).
4. Choose the region US East (Virginia), or whichever metro matches the Neon
   region from section 1, step 1.
5. In Settings, Environments, duplicate the production environment to create a
   second environment named `development`. Both environments deploy from
   `main`.
6. Set the production environment variables:

   | Variable                             | Value                              |
   | ------------------------------------ | ---------------------------------- |
   | `CROSSTUNE_ENVIRONMENT`              | `production`                       |
   | `CROSSTUNE_DEBUG`                    | `false`                            |
   | `CROSSTUNE_DATABASE_URL`             | Neon production string, as printed |
   | `CROSSTUNE_CLERK_ISSUER`             | `https://clerk.<domain>`           |
   | `CROSSTUNE_CLERK_AUTHORIZED_PARTIES` | `["https://<domain>"]`             |
   | `CROSSTUNE_CORS_ORIGINS`             | `["https://<domain>"]`             |
   | `CROSSTUNE_CLERK_WEBHOOK_SECRET`     | set after the webhook step below   |
   | `CROSSTUNE_SENTRY_DSN`               | `crosstune-api` DSN                |

7. Set the development environment variables:

   | Variable                                 | Value                                               |
   | ---------------------------------------- | --------------------------------------------------- |
   | `CROSSTUNE_ENVIRONMENT`                  | `development`                                       |
   | `CROSSTUNE_DEBUG`                        | `false`                                             |
   | `CROSSTUNE_DATABASE_URL`                 | Neon development string, as printed                 |
   | `CROSSTUNE_CLERK_ISSUER`                 | `https://<slug>.clerk.accounts.dev`                 |
   | `CROSSTUNE_CLERK_AUTHORIZED_PARTIES`     | `["http://localhost:5173","http://localhost:4173"]` |
   | `CROSSTUNE_CLERK_AUTHORIZED_PARTY_REGEX` | `^https://[a-z0-9-]+\.crosstune\.pages\.dev$`       |
   | `CROSSTUNE_CORS_ORIGINS`                 | `["http://localhost:5173","http://localhost:4173"]` |
   | `CROSSTUNE_CORS_ORIGIN_REGEX`            | `^https://[a-z0-9-]+\.crosstune\.pages\.dev$`       |
   | `CROSSTUNE_CLERK_WEBHOOK_SECRET`         | set after the webhook step below                    |
   | `CROSSTUNE_SENTRY_DSN`                   | `crosstune-api` DSN                                 |

   Railway injects `PORT`, and the container reads it.

8. Add domains:

   - Production: add the custom domain `api.<domain>`. Railway shows a CNAME
     target. Add it to Cloudflare DNS with the proxy off.
   - Development: click **Generate domain**, and record the result as
     `<railway-dev-domain>`.

   Now return to section 3, step 7, add the two webhook endpoints, and set
   `CROSSTUNE_CLERK_WEBHOOK_SECRET` in each Railway environment.

9. The API writes JSON lines, and Railway's log explorer indexes the fields.
   The architecture spec planned a log drain; this deliberately defers it,
   since Railway's built-in log explorer is enough for the first release.

## 5. Cloudflare Pages

1. In Workers & Pages, click **Create**, choose **Pages**, and connect the
   GitHub repository. Name the project `crosstune`. This name fixes the
   preview hostnames at `*.crosstune.pages.dev`, which the development API's
   regex expects. If `crosstune` is taken, use whatever project name
   Cloudflare assigns instead, and update both `CROSSTUNE_CORS_ORIGIN_REGEX`
   and `CROSSTUNE_CLERK_AUTHORIZED_PARTY_REGEX` in section 4, step 7 to
   match, since both are derived from the preview hostname. Set the
   production branch to `main`.
2. Set the build settings: framework preset None, build command `pnpm build`,
   build output directory `dist`, root directory `web`.
3. In Settings, Builds, set the build watch paths to include `web/*`.

   > `PNPM_VERSION` in the tables below matches the version in
   > `web/package.json`'s `packageManager` field. An older pnpm cannot read
   > the lockfile.

4. Set the production environment variables:

   | Variable                     | Value                  |
   | ---------------------------- | ---------------------- |
   | `VITE_API_URL`               | `https://api.<domain>` |
   | `VITE_CLERK_PUBLISHABLE_KEY` | `pk_live_...`          |
   | `VITE_SENTRY_DSN`            | `crosstune-web` DSN    |
   | `VITE_SENTRY_ENVIRONMENT`    | `production`           |
   | `NODE_VERSION`               | `22`                   |
   | `PNPM_VERSION`               | `12.4.1`               |

5. Set the preview environment variables:

   | Variable                     | Value                          |
   | ---------------------------- | ------------------------------ |
   | `VITE_API_URL`               | `https://<railway-dev-domain>` |
   | `VITE_CLERK_PUBLISHABLE_KEY` | `pk_test_...`                  |
   | `VITE_SENTRY_DSN`            | `crosstune-web` DSN            |
   | `VITE_SENTRY_ENVIRONMENT`    | `development`                  |
   | `NODE_VERSION`               | `22`                           |
   | `PNPM_VERSION`               | `12.4.1`                       |

6. Add the custom domain `<domain>` to the Pages project. Cloudflare creates
   the DNS record. The Clerk production instance is bound to this domain.
7. In the Cloudflare dashboard, enable HTTP Strict Transport Security for the
   zone. `_headers` does not set it.

`web/public/_headers` sets three security headers (`X-Content-Type-Options`,
`X-Frame-Options`, `Referrer-Policy`) on every response, forces revalidation
of `/sw.js` and `/manifest.webmanifest` so the service worker and the
manifest never serve stale, and caches everything under `/assets/*` for a
year because those filenames are hashed and never change. The project has no
`404.html`, so
Cloudflare Pages falls back to `index.html` for any path that does not match a
file. This fallback is what lets a client-side route such as `/songs/new` load
directly.

## 6. GitHub

1. In Settings, Secrets and variables, Actions, Variables, add:

   - `PRODUCTION_API_ORIGIN` = `https://api.<domain>`
   - `PRODUCTION_WEB_ORIGIN` = `https://<domain>`
   - `CLERK_ISSUER` = the development issuer

2. In the same place, under Secrets, add the values the `E2E` workflow needs:

   - `CLERK_SECRET_KEY`: the development instance's `sk_test_...` key
   - `VITE_CLERK_PUBLISHABLE_KEY`: the development instance's `pk_test_...` key
   - `E2E_CLERK_USER_EMAIL`: the email of a user that exists in the
     development instance

## 7. Smoke check

After the first production deploy, run the smoke check locally from the
repository root (the module justfiles under `api/` and `web/` do not define
`smoke`):

```bash
just smoke https://api.<domain> https://<domain>
```

Or run the **Smoke** workflow from the Actions tab. A blank input uses the
`PRODUCTION_API_ORIGIN` and `PRODUCTION_WEB_ORIGIN` repository variables.

The check runs seven tests:

1. The API's `/healthz` endpoint answers `{"status":"ok"}`.
2. The API rejects an anonymous call to `/v1/me` with a 401 status and an
   `application/problem+json` body.
3. The API grants CORS to the web origin on a preflight request to
   `/v1/sync/push`.
4. The web origin serves the app shell at `/`.
5. The web origin serves the manifest, and the manifest names Crosstune.
6. The web origin serves the service worker at `/sw.js`.
7. The web origin serves the app shell for a client-side route such as
   `/songs/new`.

For the development environment, run this from the repository root too:

```bash
just smoke https://<railway-dev-domain> https://<branch>.crosstune.pages.dev
```

Then run the manual test on a phone:

1. Open `https://<domain>`.
2. Sign in.
3. Add a tune.
4. Paste a YouTube link.
5. Install the app to the home screen.
6. Turn on airplane mode.
7. Edit the tune.
8. Turn off airplane mode.
9. Confirm that the edit synced. Settings shows the last sync time.

## End-to-end tests in CI

The `E2E` workflow runs from the Actions tab on demand. It is not a pull
request check, for three reasons:

- The suite signs in through the live Clerk development instance. An outage or
  a rate limit there would block merges unrelated to the change under review.
- The suite must run green from a manual dispatch before it can gate pull
  requests.
- The repository has no GitHub remote and no secrets until you complete the
  steps in this runbook.

Once the suite has run green from a manual dispatch, promote it to a pull
request check. Edit the `on:` block in `.github/workflows/e2e.yml` to add:

```yaml
pull_request:
  paths: ["web/**", "api/**"]
```

## Releasing

A merge to `main` deploys the API in both environments and the production web
client. Railway skips the deploy when nothing under `api/` changed.
Cloudflare Pages skips the deploy when nothing under `web/` changed.

Version tags come from commitizen: run `cz bump` in `api/`. This updates only
the API's version. Bump the `version` field in `web/package.json` by hand as
part of the same release, so the web Sentry release tag changes too.

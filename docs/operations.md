# Crosstune operations

This page covers how code reaches the hosts and how to confirm that a
deploy works: the delivery pipeline, pull request environments, releases,
the smoke check, and the order to rebuild the hosts from nothing. For the
settings each host holds, read `hosting.md`. For local development, read
the README at the repository root.

## Delivery

GitHub holds the source, and both hosts deploy from it. Every commit that
lands on `main` is deployed. There is no release branch, no promotion step,
and no batching.

- Railway builds the API service in the `production` and `development`
  environments on a push to `main` that touches a file under `api/`. A pull
  request environment follows its PR branch instead and rebuilds on every push
  to it.
- Workers Builds builds the web client on every push under `web/`. A push to
  `main` deploys production. A push to any other branch uploads a version
  under the branch's alias, at
  `https://<alias>-crosstune-web.<workers-subdomain>.workers.dev`, and Workers
  Builds comments the URL on the pull request.
- The `Development` workflow force-pushes every commit on `main` to the
  `development` branch. Workers Builds uploads that branch under the alias
  `development`, which has no KV entry. The result is one stable URL for the
  development environment,
  `https://development-crosstune-web.<workers-subdomain>.workers.dev`. The
  branch rebuilds only when a push changes a file under `web/`. Do not open a
  pull request from `development`, because the `Preview` workflow then gives
  the alias its own API and database.
- The `Preview` workflow gives each pull request its own API and database.
  When a PR opens, it creates a Neon branch `pr-<number>` from the development
  database, creates a Railway environment `pr-<number>` copied from
  `development` with that branch as its database and the PR branch as its
  source, reads the environment's generated hostname, and stores it in KV under
  the branch alias. On every push it resets the Neon branch to its parent, so
  each build migrates a clean copy of the development data and test data
  entered in the preview is lost. When the PR closes, it deletes all three.
  If a close event ever fails to clean up, the same workflow runs from the
  Actions tab with the PR number and branch name and deletes them.

GitHub Actions runs on every pull request and on every push to `main`. The
`API` workflow lints, type checks, tests against a real Postgres 18, and
verifies the committed OpenAPI contract. The `Web` workflow lints, type
checks, tests, builds, and verifies the generated client types. Railway
holds a deploy until every workflow for that commit passes, because Wait for
CI is on in both environments, and skips the deploy when one fails. Workers
Builds does not wait.

The `E2E` workflow runs the Playwright suite on each pull request that
changes `web/` or `api/`, and from the Actions tab on demand. It signs in
through the live Clerk development instance. Its job is not a required
status check in the `main` ruleset. As a required check, an outage or a rate
limit at Clerk can block unrelated merges. A new push to the same pull
request cancels the run in progress, so fewer sign-ins count against the
instance's usage limits.

Rollback on either host is one click to redeploy an earlier build. A bad
commit is undone in minutes, and the outbox means a client outage loses no
edits.

## Rebuilding from nothing

A rebuild from nothing works through the hosts in the order Neon, Sentry,
Clerk, Railway, Cloudflare, GitHub, then the smoke check. It returns to Clerk
for the webhooks once Railway has hostnames.

## Smoke check

After a deploy, run the smoke check from the repository root. It needs no
credentials.

```bash
just smoke https://api.<domain> https://<domain>
```

The **Smoke** workflow in the Actions tab runs the same script. A blank input
uses the `PRODUCTION_API_ORIGIN` and `PRODUCTION_WEB_ORIGIN` Actions
variables listed in `hosting.md`.

The script proves seven things. The API answers `{"status":"ok"}` at
`/healthz`. It refuses an anonymous call to `/v1/me` with a 401 and a
problem-details body. The web origin proxies `/v1/me` to the API and
returns its 401 problem document. The web origin serves the app shell, a
manifest that names Crosstune, the service worker, and the app shell again
for a client-side route.

For a pull request, point it at the PR's Railway hostname and its preview URL.

```bash
just smoke https://<railway-dev-domain> https://<alias>-crosstune-web.<workers-subdomain>.workers.dev
```

The manual test on a phone covers what the script cannot.

1. Open `https://<domain>` and sign in.
2. Add a song and paste a YouTube link.
3. Install the app to the home screen.
4. Turn on airplane mode and edit the song.
5. Turn off airplane mode.
6. Make sure that the edit synced. Settings shows the last sync time.

## Releasing

A merge to `main` deploys the API in both environments and the production
web client. Railway skips the deploy when nothing under `api/` changed.
Workers Builds skips the deploy when nothing under `web/` changed.

To cut a version, run `just bump` at the repository root. It runs
commitizen from `.cz.toml`, which updates the API package version and the
`version` field in `web/package.json` in one commit, then tags it. Each
value becomes the Sentry release tag for its side. Tags trigger nothing.

When you bump pnpm in the `packageManager` field of `web/package.json`,
update `PNPM_VERSION` in the Worker's build variables in the same change. A
Node bump is one edit to `web/.node-version`.

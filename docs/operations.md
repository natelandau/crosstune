# Crosstune operations

This page covers how code reaches the hosts and how to confirm that a
deploy works: the delivery pipeline, pull request environments, releases,
the smoke check, and the order to rebuild the hosts from nothing. For the
settings each host holds, read `hosting.md`. For local development, read
the README at the repository root.

## Delivery

GitHub holds the source, and both hosts deploy from it. A merge to `main`
deploys the development environment. A version tag deploys production. The
`Release` workflow moves the `production` branch to the tagged commit, and
both hosts deploy production from that branch, because neither can trigger
on a tag. Nothing else writes to `production`.

- Railway builds the API service in the `development` environment on a push
  to `main` that touches a file under `api/`, and in the `production`
  environment on a push to `production`. A pull request environment follows
  its PR branch instead and rebuilds on every push to it.
- Workers Builds builds the web client on every push under `web/`. A push to
  `production` deploys production. A push to any other branch, `main`
  included, uploads a version under the branch's alias, at
  `https://<alias>-crosstune-web.<workers-subdomain>.workers.dev`, and Workers
  Builds comments the URL on the pull request.
- A push to `main` uploads a version under the alias `main`, which has no KV
  entry, so it reads the development API. That is the development
  environment's URL,
  `https://main-crosstune-web.<workers-subdomain>.workers.dev`. It rebuilds
  only when a push changes a file under `web/`.
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

GitHub Actions runs on every pull request and on every push to `main`,
except a release bump commit, whose checks run inside the `Release` workflow
instead. The
`API` workflow lints, type checks, tests against a real Postgres 18, and
verifies the committed OpenAPI contract. The `Web` workflow lints, type
checks, tests, builds, and verifies the generated client types. Railway
holds a development deploy until every workflow for that commit passes,
because Wait for CI is on in that environment, and skips the deploy when one
fails. Production has no host-side gate. The `Release` workflow runs the
`API` and `Web` workflows on the tagged commit and moves the `production`
branch only when both pass, so neither host builds an untested commit.

The `E2E` workflow runs the Playwright suite on each pull request that
changes `web/` or `api/`, and from the Actions tab on demand. `just e2e` runs
the same suite locally, against the API on the `crosstune_e2e` database rather
than the one a development session serves, so it needs no session stopped. It signs in
through the live Clerk development instance. Its job is not a required
status check in the `main` ruleset. As a required check, an outage or a rate
limit at Clerk can block unrelated merges. A new push to the same pull
request cancels the run in progress, so fewer sign-ins count against the
instance's usage limits.

Rollback on either host is one click to redeploy an earlier build, or one
run of the `Release` workflow from an earlier tag, which moves both hosts at
once. A bad commit is undone in minutes, and the outbox means a client
outage loses no edits.

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

A merge to `main` deploys the API's `development` environment and the
`development` preview. Railway skips the deploy when nothing under `api/`
changed. Workers Builds skips the deploy when nothing under `web/` changed.
Production changes only when a version tag is pushed.

A change to the shape of a song row is refused in both directions while the
two sides disagree. The API turns away a push carrying a field it does not
know and a push missing one it now expects, so an old client against the new
API and a new client against the old API fail alike. A refused push is
settled rather than retried, and its queued entry is dropped, so the edit
behind it is lost.

One tag rebuilds both services, so no single release moves one side alone:
the two deploys land within minutes of each other, in whichever order the
builds finish, and a song edited inside that window is an edit lost.
Splitting the change over two releases puts the order in your hands. Send
the client first and keep the gap to minutes, because you then choose when
the API follows; an API sent first leaves every install broken until its
service worker updates.

The only path that loses nothing is a transitional API release that accepts
both shapes, then a later one that drops the old field.

The app icon's file names never change, so a home-screen install made
before an icon change keeps the icon it was installed with until the app
is removed and added again. A release that changes the icon should say
so.

To cut a release, on `main` with a clean tree:

```bash
git switch main && git pull
just bump
git push --follow-tags origin main
```

`just bump` runs commitizen from `.cz.toml`, which updates the API package
version and the `version` field in `web/package.json` in one commit, writes
the changelog, and tags the commit `v<version>`. Each value becomes the
Sentry release tag for its side. The tag push starts the `Release` workflow.
It runs the `API` and `Web` workflows on the tagged commit, and when both
pass, a final job checks that the commit is on `main` and force-pushes it to
`production`. Both hosts deploy it. The push of the bump commit to `main`
skips those two workflows, so each release runs the checks once. Every
release rebuilds both services, because the bump commit touches a file under
`api/` and one under `web/`.
Bump on `main` only: a tag made on a pull request branch points at a commit
that the squash merge never lands, and the workflow refuses it.

To put an older version back, open the `Release` workflow on the Actions
tab, click **Run workflow**, and choose that tag under **Use workflow from**.
Both hosts redeploy the older commit. A rollback across a
migration fails the pre-deploy command, because the older code does not know
the newer revision. Roll forward instead, or downgrade the schema first.

When you bump pnpm in the `packageManager` field of `web/package.json`,
update `PNPM_VERSION` in the Worker's build variables in the same change. A
Node bump is one edit to `web/.node-version`.

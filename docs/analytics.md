# Analytics

The rules for every analytics event, on every client. The plan file
`analytics/tracking-plan.json` lists the events, properties, enums, and
buckets. This page never lists them.

## Site and app

One PostHog Cloud project, production only, receives the public site and
the app. No other environment has a token.

- `product` and `platform`, super properties on every event, separate
  the site from the app.
- The app sends `$screen` on every platform, the web app included. Only the
  site sends `$pageview`.

Filter every chart by `product`. A chart with no `product` filter mixes
two audiences.

- The site is anonymous. The app identifies a person by Clerk user ID,
  never by email or name.
- Events leave through PostHog's managed reverse proxy on a product
  subdomain, so a blocker that lists PostHog's host does not drop them.
  Never a proxy of our own.

## Rules

- **Names.** An event name is `object_verb` in snake_case and past tense.
  Name the intent of the user, never the screen or component that sends
  the event.
- **One event per object and action.** Write `tune_deleted` and
  `list_deleted`, never `item_deleted`. `setting_changed` is the one
  exception. It covers many small switches, and its `setting` property
  names the switch.
- **Content rule.** An event never carries free text, a title, a name, a
  URL, a file name, or search text. An ID never travels in an event that
  carries one of these.
- **ID rule.** An event can carry the random UUID of a tune, list,
  recording, link, or scan. PostHog cannot resolve a UUID to content.
- **Person properties.** Each person property in the plan lists the
  `clients` that set it. A client sets only the properties that list it.
- **Properties.** A property is an enum, a boolean, a bucket, a number,
  or an ID. The plan lists every allowed value. A value that is not in
  the plan is a bug. A number is a small setting or offset, such as
  `semitones`, never a count, a duration, or a size.
- **Setting values.** The `value` of `setting_changed` takes its type
  from the `settings` section, by the setting it names.
- **Free format.** `$referrer`, `$referring_domain`, and the `utm_*`
  properties on the site's `create_account_clicked` and
  `app_store_clicked` are free text, the one exception to the content
  rule. PostHog reads them from the page the visitor clicked on.
- **Buckets.** A count, duration, or size travels as a fixed range. The
  `buckets` section of the plan defines each range once. Never send the
  raw number.
- **Web URLs.** A new web route word that is not an ID goes in
  `KEPT_SEGMENTS` in `web/src/usage/scrub.ts`, or charts show it as
  `:id`.
- **No milestone events.** A device cannot know that an action is the
  first one for a person. Build "first time" in a PostHog funnel. The one
  exception is `account_created`: the API decides it and tells the client in
  the response that created the account, so it is sent at most once per account.
- **No session replay** on any platform.
- **Share usage data starts from the region.** Until the user chooses,
  `/v1/region` sets the default: off where consent is required or the
  country is unknown, on elsewhere. A client holds its calls in memory
  until the default loads. A stored choice always wins.
- **Named events only in the app.** Autocapture is off in the app on every
  platform.

## Add or change an event

1. Edit `analytics/tracking-plan.json`. Give the event a description, the
   clients that send it, its properties, and its `answers`: the keys of
   the questions it answers, from the `questions` section.
2. Run `just analytics::check`. It rejects a name that is not
   snake_case, an unknown enum, bucket, or question, and a string
   property without an enum, bucket, or format.
3. Add the code to each client that sends the event. On Apple, a model
   receives the `AnalyticsClient` as an init parameter, and a view reads
   it from the environment. On the web, a component reads the client
   with `useAnalytics()`, code outside React takes it as an argument, and
   nothing in `web/src/commands/` sends.
4. Run each client's contract test: `web/src/usage/trackingPlan.test.ts`,
   `apple/CrosstuneKit/Tests/CrosstuneAnalyticsTests/TrackingPlanTests.swift`,
   `site/test/tracking-plan.test.ts`. A new client: add
   `analytics/tracking-plan.json` to its workflow's `paths`.
5. Merge. CI runs `just analytics::sync` on a push to `main` that changes
   `analytics/`. To sync before merging: run it by hand.

`just analytics::audit`: compare PostHog with the plan.

`sync` and `audit` read a PostHog key from `analytics/.env`, which Git
ignores. Run `just analytics::test` to test the checker.

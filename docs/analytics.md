# Analytics

The rules for every analytics event, on every client. The plan file
`analytics/tracking-plan.json` lists the events, properties, enums, and
buckets. This page never lists them.

## Site and app

One PostHog project receives the public site and the app. Two super
properties separate them.

- `product` is `site` or `app`. Every event carries it.
- `platform` is `site`, `web`, `ios`, `ipados`, or `macos`. Every event
  carries it.
- The app sends `$screen` on every platform, the web app included. Only the
  site sends `$pageview`.

Filter every chart by `product`. A chart with no `product` filter mixes
two audiences.

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
- **Properties.** A property is an enum, a boolean, a bucket, a number,
  or an ID. The plan lists every allowed value. A value that is not in
  the plan is a bug. A number is a small setting or offset, such as
  `semitones`, never a count, a duration, or a size.
- **Setting values.** The `value` of `setting_changed` takes its type
  from the `settings` section, by the setting it names.
- **Free format.** `$referrer`, `$referring_domain`, and the `utm_*`
  properties on the site's `waitlist_joined` are free text, the one
  exception to the content rule. They hold the values PostHog reads from
  the join page, passed on unchanged.
- **Buckets.** A count, duration, or size travels as a fixed range. The
  `buckets` section of the plan defines each range once. Never send the
  raw number.
- **No milestone events.** A device cannot know that an action is the
  first one for a person. Build "first time" in a PostHog funnel.
- **Named events only in the app.** Autocapture is off in the app on every
  platform.

## Add or change an event

1. Edit `analytics/tracking-plan.json`. Give the event a description, the
   clients that send it, its properties, and its `answers`: the keys of
   the questions it answers, from the `questions` section. An event that
   answers no question is not added.
2. Run `just analytics::check`. It rejects a bad name, an unknown enum or
   bucket, an answer that names no question, and a property that breaks
   the content rule.
3. Add the code to each client that sends the event.
4. Run the contract test of each client. The test fails if the client and
   the plan differ in either direction.
5. Run `just analytics::sync`. It pushes the description and tags of each
   event to the PostHog event definitions.

Run `just analytics::audit` to compare PostHog with the plan. It lists
the events that PostHog received in the last 30 days but the plan does
not list. It also lists the events in the plan that PostHog never
received.

`sync` and `audit` read a PostHog key from `analytics/.env`, which Git
ignores. Run `just analytics::test` to test the checker.

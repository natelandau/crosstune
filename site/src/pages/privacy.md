---
layout: ../layouts/Legal.astro
title: Privacy policy
description: What Crosstune stores, who processes it, and how to delete it.
path: /privacy
---

# Privacy policy

Last updated: 2026-10-07

Crosstune is run by Nathaniel Landau, an individual. This page explains what data the service holds and who handles it. Questions go to [support@crosstune.app](mailto:support@crosstune.app).

## What we hold

- Your account details: your email address and, if you sign in with Google or Apple, the name and profile details they share.
- Your catalog: your tunes, lists, statuses, notes, and links.
- Your recordings: the audio you record or add to a tune.
- Your scans: the images you add to a tune from the camera, your photo library, or a file, such as written music, lyric sheets, or notes.
- Your activity: when you play recordings and links, your practice sessions, when you view a tune's scans, and changes to a tune's status.

## Who processes it

- Clerk handles sign-in. It holds your email address, your name and profile details, and your session data.
- Neon hosts the database that holds your catalog and your activity.
- Railway runs the Crosstune API.
- Cloudflare serves this site and the web app. It also stores your recordings and scans in its R2 storage and forwards email sent to support@crosstune.app through Cloudflare Email Routing.
- Sentry receives error reports from the API and the web app.
- PostHog Cloud, in the United States, receives usage analytics from this site and from the iPhone, iPad, and Mac apps. See Usage analytics below for what it receives.

## The waitlist

The waitlist form loads Clerk when you focus the email field. Clerk sets cookies on crosstune.app. When you join the waitlist, Clerk holds your email address until we invite you or you ask us to remove it. To remove it, write to [support@crosstune.app](mailto:support@crosstune.app).

## Data on your devices

The app stores your full catalog on your own devices so that it works offline. When you sign out, the app deletes that copy from the device.

## Usage analytics

This site and the iPhone, iPad, and Mac apps send usage analytics to PostHog. The web app sends none.

PostHog receives each request's IP address and uses it to estimate your approximate location, which is your country and city. It also receives which pages and features you use, and your device and software details. On this site, those details are your browser, operating system, screen size, time zone, and the page that referred you. In the apps, they are your device model, operating system version, screen size, language, time zone, whether you are on Wi-Fi or cellular, and the app version. The apps also report when you install, update, open, and leave them.

On this site, the analytics are not linked to an account, and they store nothing in cookies or local storage. The site has no switch to turn them off, but a content blocker stops them.

The apps link this data to your account. They never send your email address or name to PostHog. They never send tune names, notes, lyrics, scans, or recordings.

While Share usage data is on, the iPhone and iPad apps record your sessions. The Mac app does not record. The recording masks text inputs, images, and all of your content.

To turn this off, turn off Share usage data in the app: Settings > About on iPhone and iPad, Settings > General on Mac. While it is off, the app stops collecting usage data. Data collected just before you turned it off can still upload.

When you delete your account, we ask PostHog to delete the analytics data linked to your account, including session recordings, and ask again a few minutes later to catch data sent just before the deletion. PostHog deletes events in a weekly batch. If Share usage data is on, the app then reports that an account was deleted, without anything that links the report to you.

## What we do not do

There are no ads. We do not sell your data.

## Storage limit

Free accounts hold 50 MB of recordings and scans together. Premium accounts hold 5 GB.

## Deleting your account

Open Settings in the app and delete your account. This deletes your data from Crosstune, and the deletion cannot be undone. Some copies can remain in database history for a short time before they expire.

## Changes

If this policy changes, we update the date at the top of this page.

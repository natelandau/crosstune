# Premium judgment cases

Each case judges one stored entitlements row against the device clock and checks the plan, the one-time notice that is due, and the next instant either answer changes.

- `input.row` is the entitlements row as pull returns it, with the wire field names from `api/openapi.json`, or `null` when no row is stored yet.
- `input.now` is the device clock.
- `input.holds_recordings` says whether the account holds any recording.
- `expected.plan` holds `kind` (`unknown`, `premium`, or `free`), `source` (the live grant's source), `premium_ends_at` (the reported expiry, before any leeway), `trial_starts_at`, `trial_ends_at`, `quota_bytes`, `auto_renews`, `paid_sources`, and `lapse` (`paid`, `trial`, or `null`).
- `expected.due_notice` is `first_recording`, `trial_reminder`, `trial_ended`, or `null`.
- `expected.next_change` is the next instant the plan or the due notice changes, or `null` when none is ahead.

Timestamps compare by instant.

The cases pin these rules:

- No row gives an unknown plan, which gates nothing.
- A grant counts until its expiry, plus seven days when it renews on its own. A grant with no expiry never lapses.
- A free plan keeps the expiry it lost and says whether it lost a trial or a paid grant.
- `paid_sources` lists every store whose grant still counts, `apple` before `stripe`, and includes the reported grant's store when it is a paid source. A comp is not a store. A row without `paid_grants` lists only the reported grant's store.
- Only a trial, a lapsed trial, or a row with a trial end and no grant source sees a notice. A row with a trial end and no grant source sees only the trial-ended notice. In order: the trial-ended notice on a free plan whose trial has ended, the reminder in the last three days of a trial, then the recording notice for a trial that holds recordings. A notice already seen is never due again.
- The next change is the earliest future grant end, the trial end, or the reminder start. A paid or comped plan has no trial instant.

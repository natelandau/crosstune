# Sync events cases

Each case starts from a local database, applies one page of the history pull (`GET /v1/sync/events`), and checks the local database that results.

`input.local`, `expected.local`, and `input.page` have the shape described in `fixtures/sync-pull/README.md`, `absent_fields` included.

On Apple the `absent_fields` check is structural: history records have no `user_id` column, so no stored row can carry one.

The cases pin these rules:

- Each history row is stored in its own table, without its ownership key, and replaces any local copy with the same `id`.
- A row from a table this client has no store for is skipped.
- The events cursor moves to `next_since`, also for an empty page, and the pull cursor stays.

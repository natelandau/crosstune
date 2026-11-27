# Sync pull cases

Each case starts from a local database, applies one page of the main pull, and checks the local database that results.

`input.local` and `expected.local` describe the local database:

- `rows`: an object keyed by table name. Each value is the table's rows, in any order, as wire rows without ownership keys. A case compares only the tables it names and, for each row, only the fields the expected row carries. Each of those fields must be present on the stored row: a missing field and a null field differ. Timestamps compare by instant. A table named with an empty list must hold no rows.
- `outbox`: the queue of unsent changes, in queue order, as in `fixtures/outbox`.
- `pull_cursor` and `events_cursor`: the stored cursors.
- `local_only`: optional. The recordings and scans kept local until the account is Premium. In `input.local` it is the stored list. In `expected.local` it is the list that counts: a row counts only while its upsert is queued. Left out of `expected.local`, it is not compared.
- `absent_fields`: optional, only in `expected.local`. An object keyed by table name whose value lists field names that no stored row of that table may carry, such as the ownership key `user_id`.

`input.page` is the pull page: `rows` holds `{table, row}` objects in server order, and `next_since` is the cursor the page ends at.

The cases pin these rules:

- A pulled row with no queued local edit replaces the local row, without its ownership keys.
- A queued local edit with a newer `updated_at` than the pulled row keeps the local row and its outbox entry.
- A pulled row with an equal or newer `updated_at` replaces the local row and removes the queued entry for that row only.
- A pulled recording or scan that removes a queued upsert also ends its hold, since the server already has the row.
- A tombstone (`deleted_at` set) is stored like any other row.
- A row from a table this client has no store for is skipped.
- The entitlements row is stored.
- A field the client does not model is kept on the stored row.
- The pull cursor moves to `next_since` and the events cursor stays.

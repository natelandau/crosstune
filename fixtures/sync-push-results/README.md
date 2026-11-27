# Sync push results cases

Each case starts from a local database, applies the server's results for one pushed batch, and checks the local database and what the apply returns.

`input.local` and `expected.local` describe the local database in the shape given in `fixtures/sync-pull/README.md`, `local_only` and `absent_fields` included.

- `input.sent`: the batch as it left the device, in queue order, in the outbox entry shape. Each sent row must have an entry in `input.local.outbox`. A sent entry whose `updated_at` differs from the queued one stands for a write queued after the batch left.
- `input.results`: the push response's results, in server order, as `{table, id, status, reason?, row?}`. `status` is `applied`, `stale`, or `invalid`.
- `expected.invalid`: the refused changes the client reports, as `{table, id, reason}`, in batch order.
- `expected.settled`: how many sent entries left the outbox.
- `expected.kept_local`: the recordings and scans this batch keeps local until the account is Premium, in batch order.

The cases pin these rules:

- `applied` removes the entry. A sent row with no result keeps its entry.
- `stale` stores the returned row, without its ownership key, and removes the entry.
- `invalid` on an upsert is reported with its reason and removes the entry. The local row stays.
- `invalid` on a delete removes the entry without a report.
- `invalid` on a history row deletes the local row and removes the entry without a report.
- A recording or scan upsert refused for Premium (`premium required`) keeps its entry, is kept local, and is not reported or counted as settled.
- A row refused because its recording is missing keeps its entry, unreported, while that recording is kept local, and the recording is listed in `kept_local`. A hold whose row has no queued upsert does not count, so the refused row is then reported and settled.
- A write queued after the batch left keeps its entry, whatever the result.
- When the results name one row twice, the last result applies.

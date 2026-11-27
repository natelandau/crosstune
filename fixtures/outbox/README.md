# Outbox cases

Each case starts from a queue of unsent changes and adds more, then checks the queue that results.

An entry has the fields `table`, `row_id`, `op`, `updated_at`, and `data`. `op` is `upsert` or `delete`. `data` is the row's change for an upsert and `null` for a delete.

- `input.outbox` is the queue before the case runs, in queue order.
- `input.enqueue` is the list of entries added afterward, one at a time, in the order given.
- `expected.outbox` is the queue after every entry is added, in queue order. Entries carry no `seq` value.

The cases pin these rules:

- A row has one entry. The key is the table and `row_id` together, so the same `row_id` in two tables gives two entries.
- A write to a row with a queued entry replaces that entry, including an upsert replaced by a delete, and the entry keeps its queue position.
- A write to a row with no queued entry adds an entry at the end of the queue.

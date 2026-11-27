# Upload hand-off cases

Rules that decide what happens to a recording upload handed to a background worker. Every case has `input.check`, which is `status` or `attempt`.

## `status`

Whether a hand-off may still be finished by the worker.

- `input.handoff`: `expires_at` (ISO 8601 UTC), `attempts`, `refused`, `put_landed`.
- `input.now`: ISO 8601 UTC.
- `expected.status`: `live`, `expired`, or `take_back`.

A hand-off is `expired` when `expires_at` is at or before `now`. Otherwise it is `take_back` when `refused` is true or `attempts` is 3 or more. Otherwise it is `live`.

## `attempt`

What one run of the worker concludes.

- `input.put` and `input.confirm`: an HTTP status number, `network_error`, or `skipped` (the step was not sent).
- `expected.result`: `uploaded`, `refused`, `retry`, or `retry_confirm`.

A failed upload is `retry`. After an upload that returned 2xx or was skipped, a 2xx confirm is `uploaded`, a network error or a retryable status is `retry_confirm`, and any other status is `refused`.

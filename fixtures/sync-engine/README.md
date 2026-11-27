# Sync engine cases

Each case starts from a local database, runs the client's sync engine against a scripted server, and checks the requests the engine sent and the local database that results.

`input.local` and `expected.local` describe the local database in the shape given in `fixtures/sync-pull/README.md`, `local_only` and `absent_fields` included.

- `input.batch_size`: optional. How many outbox entries one push sends. Left out, the engine's default applies.
- `input.responses`: what the server answers, in order, as `{route, status, body}`. The server returns the next response to each request. A request with no response left, a request whose route differs from the next response's `route`, and a response no request takes each fail the case.
- `input.actions`: what the case does to the engine, in order, without waiting for each other:
    - `sync`: starts a sync run.
    - `pull_events`: starts an events pull.
    - `stop`: stops the engine while the next request is in flight, before its response returns.
- `expected.requests`: every request the engine sent, in order, as `{route, body}`. `route` is the method and the path with its query, such as `POST /v1/sync/push` or `GET /v1/sync/pull?since=3`. `body` is the JSON body, or `null` for none. Requests compare by route and body only, never by headers or timing. Timestamps in a body compare by instant.

The case ends once every run it started has finished.

The cases pin these rules:

- A push sends the outbox in queue order, in batches of the batch size, until a batch comes back short.
- A sync run pushes, then pulls, then reads the account (`GET /v1/me`).
- A `stale` result stores the server's row, and the run goes on to pull.
- An `invalid` result drops its entry, keeps the local row, and the run goes on.
- A row the server refuses for Premium stays queued and kept local, and the same run never sends it again, even while the device judges the account Premium.
- While free, a recording or scan kept local is not sent, nor an upsert that names that recording, and the entries behind them still go.
- A stopped engine sends no further request, and a response that arrives after the stop is dropped, never written.
- The pull and the events pull each ask for the next page from the last page's `next_since` until a page has `has_more` false, and store every page.

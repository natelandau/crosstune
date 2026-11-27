# Split parent hold cases

Each case lists recordings and says which parents a waiting piece holds.

- `input.recordings` are recordings as wire rows, with the field names from `api/openapi.json`. A field a row leaves out takes its default.
- `input.excluded_piece_ids` are pieces about to be deleted.
- `expected.waiting_parent_ids` are the parents of every waiting piece, sorted.
- `expected.held_parent_ids` are the recordings in `input.recordings` that stay and whose Delete waits, sorted.

The cases pin these rules:

- A live piece in `processing` holds its parent.
- A piece that is `ready`, deleted, or excluded holds nothing.
- A `failed` parent is never held.
- Several pieces of one parent hold it once.

# Write timestamp cases

Each case gives the `updated_at` stored on a row (`stored`, `null` when the row is new) and the time the write asks for (`requested`). `expected.stamped` is the time the write is saved with. A write never reuses or goes below the stored time, because two writes to one row differ only by `updated_at`.

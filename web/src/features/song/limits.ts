// The server's row schema limits, so a long entry is stopped here instead of rejected on push.
export const SONG_LIMITS = {
  title: 200,
  key: 10,
  violin_tuning: 100,
  banjo_tuning: 100,
  genre: 100,
  feel: 100,
  part_structure: 100,
  learned_from: 200,
  notes: 20_000,
} as const

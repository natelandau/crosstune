/** A recorded total as `9 h 12 m`, or `12 m` under an hour. Minutes round down. */
export function formatRecorded(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours} h ${minutes % 60} m` : `${minutes} m`
}

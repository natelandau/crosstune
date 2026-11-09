/**
 * What a row's name says, its parts joined by commas: the title first, so typing a title
 * still finds the row, then the key and mode in full, the status, and the secondary line.
 */
export function spokenRow(
  title: string,
  keyName: string | null,
  status: string,
  detail: string[],
): string {
  return [title, keyName && `Key ${keyName}`, status, ...detail].filter(Boolean).join(', ')
}

/** The verbs and names a link's play control carries, wherever it shows. */

export const OPEN = 'Open'
export const CLOSE = 'Close'

export function openLinkName(title: string): string {
  return `${OPEN} ${title}`
}

/** Composed by the row from its verb, the title, and an sr-only "player" after it. */
export function closeLinkName(title: string): string {
  return `${CLOSE} ${title} player`
}

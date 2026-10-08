import { PROVIDER_LABELS } from '../../constants'
import { CLOSE } from '../../ui/confirmCopy'

/** The verbs and names a link's play control carries, wherever it shows. */

export const OPEN = 'Open'

export function openLinkName(title: string): string {
  return `${OPEN} ${title}`
}

/** Composed by the row from its verb, the title, and an sr-only "player" after it. */
export function closeLinkName(title: string): string {
  return `${CLOSE} ${title} player`
}

/** The name of the line that opens a link on its provider's own site. */
export function openOnProviderName(title: string, provider: string): string {
  return `${OPEN} ${title} on ${provider}`
}

/** The text of that line: the provider, or the bare verb for a link to no known provider. */
export function linkOutText(provider: string): string {
  return provider === PROVIDER_LABELS.other ? OPEN : provider
}

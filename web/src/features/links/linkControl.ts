import { embedFor } from '../player/embed'
import { outboundUrl } from './display'

export type LinkControl = 'play' | 'close' | 'open' | 'none'

/**
 * Which control a link row shows: a link the dock cannot embed opens its provider's own site,
 * and one it can embed plays, or closes once it is the loaded item.
 */
export function linkControl(
  link: Parameters<typeof embedFor>[0] & Parameters<typeof outboundUrl>[0],
  loaded: boolean,
): { control: LinkControl; href: string | null } {
  const href = outboundUrl(link)
  if (!embedFor(link)) return { control: href ? 'open' : 'none', href }
  return { control: loaded ? 'close' : 'play', href }
}

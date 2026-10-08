import type { LocalRecordingLink } from '../../db/types'
import { CLOSE } from '../../ui/confirmCopy'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { PLAY } from '../recordings/recordingNames'
import { displayTitle, providerLabel } from './display'
import { linkControl, type LinkControl } from './linkControl'
import { OPEN } from './linkNames'

export interface LinkRowData {
  title: string
  provider: string
  control: LinkControl
  /** The provider's own page for the link, when it can be opened. */
  href: string | null
  /** True while this link is the player's loaded item. */
  loaded: boolean
  /** What a tap on the row does and the verb that names it; undefined when it does nothing. */
  open: { onOpen: () => void; openName: string } | undefined
}

/**
 * What one link row shows and does, for every app's row: it plays a link the dock can embed
 * and opens the provider's own site for one it cannot.
 */
export function useLinkRow(link: LocalRecordingLink): LinkRowData {
  const player = usePlayer()
  const item = { kind: 'link' as const, id: link.id }
  const loaded = isPlaying(player, item)
  const { control, href } = linkControl(link, loaded)
  let open: LinkRowData['open']
  if (control === 'open') {
    // Nothing to load in the dock, so the row is the outbound link, like the one under the title.
    open = { onOpen: () => window.open(href!, '_blank', 'noopener,noreferrer'), openName: OPEN }
  } else if (control === 'close') {
    open = { onOpen: () => player.close(), openName: CLOSE }
  } else if (control === 'play') {
    open = { onOpen: () => player.play(item), openName: PLAY }
  }
  return { title: displayTitle(link), provider: providerLabel(link), control, href, loaded, open }
}

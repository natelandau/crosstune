import { useAnalytics } from '../../usage/AnalyticsProvider'
import { serviceOf } from '../../usage/service'
import type { LocalRecordingLink } from '../../db/types'
import { CLOSE } from '../../ui/confirmCopy'
import { TUNE_ROW_ORIGIN, type PlayOrigin } from '../player/playLog'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { PLAY } from '../recordings/recordingNames'
import { displayTitle, providerLabel } from './display'
import { linkControl, type LinkControl } from './linkControl'
import { OPEN } from './linkNames'
import { openExternal } from '../../platform/openExternal'

export interface LinkRowData {
  title: string
  provider: string
  control: LinkControl
  /** The provider's own page for the link, when it can be opened. */
  href: string | null
  /** Reports that the link was opened on its provider's site; call it when the musician follows `href`. */
  reportOpened: () => void
  /** True while this link is the player's loaded item. */
  loaded: boolean
  /** What a tap on the row does and the verb that names it; undefined when it does nothing. */
  open: { onOpen: () => void; openName: string } | undefined
}

/**
 * What one link row shows and does, for every app's row: it plays a link the dock can embed
 * and opens the provider's own site for one it cannot. `origin` is where a play from the row
 * counts as asked for, a tune's page by default.
 */
export function useLinkRow(
  link: LocalRecordingLink,
  origin: PlayOrigin = TUNE_ROW_ORIGIN,
): LinkRowData {
  const player = usePlayer()
  const analytics = useAnalytics()
  const item = { kind: 'link' as const, id: link.id }
  const loaded = isPlaying(player, item)
  const { control, href } = linkControl(link, loaded)
  const reportOpened = () =>
    analytics.send('link_opened_externally', {
      service: serviceOf(link.provider),
      link_id: link.id,
    })
  let open: LinkRowData['open']
  if (control === 'open') {
    // Nothing to load in the dock, so the row is the outbound link, like the one under the title.
    open = {
      onOpen: () => {
        openExternal(href!)
        reportOpened()
      },
      openName: OPEN,
    }
  } else if (control === 'close') {
    open = { onOpen: () => player.close(), openName: CLOSE }
  } else if (control === 'play') {
    open = { onOpen: () => player.play(item, origin), openName: PLAY }
  }
  return {
    title: displayTitle(link),
    provider: providerLabel(link),
    control,
    href,
    reportOpened,
    loaded,
    open,
  }
}

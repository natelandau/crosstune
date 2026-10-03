import { IonLabel } from '@ionic/react'
import { ArrowUpRight } from 'lucide-react'
import type { LocalRecordingLink } from '../../db/types'
import { Row, type RowAction } from '../../ui/Row'
import { PinnedMark } from '../tune/PinnedMark'
import { PlayGlyph, Slot, StopGlyph } from '../../ui/rowGlyphs'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { displayTitle, providerLabel } from './display'
import { PLAY } from '../recordings/recordingNames'
import { CLOSE, OPEN } from './linkNames'
import { linkControl } from './linkControl'

/**
 * A linked recording as a row shaped like an audio recording's: the row plays it when the
 * provider can be embedded and opens the provider's own site when it cannot, and the line under
 * the title is the link out to that site. The provider is named once, by that link, because a
 * second copy of the name beside it said nothing the link did not.
 */
export function LinkItem({
  link,
  actions,
  pinned = false,
}: {
  link: LocalRecordingLink
  /** True for the link a list plays for this tune. */
  pinned?: boolean
  actions?: readonly RowAction[]
}) {
  const player = usePlayer()
  const title = displayTitle(link)
  const provider = providerLabel(link)
  const item = { kind: 'link' as const, id: link.id }
  const loaded = isPlaying(player, item)
  const { control, href } = linkControl(link, loaded)

  let open: { onOpen: () => void; openName: string } | undefined
  let glyph
  if (control === 'open') {
    // Nothing to load in the dock, so the row is the outbound link, like the one under the title.
    open = { onOpen: () => window.open(href!, '_blank', 'noopener,noreferrer'), openName: OPEN }
  } else if (control === 'close') {
    open = { onOpen: () => player.close(), openName: CLOSE }
    glyph = <StopGlyph />
  } else if (control === 'play') {
    open = { onOpen: () => player.play(item), openName: PLAY }
    glyph = <PlayGlyph />
  }

  return (
    <Row
      name={title}
      actions={actions}
      start={<Slot>{glyph}</Slot>}
      note={
        href ? (
          <a
            // The row's second line, so it carries the label's own bottom space and adds none of
            // its own: a link out and a line of metadata sit the same distance under their title.
            className="type-subheadline mb-2.5 flex min-h-6 w-fit items-center gap-1 text-(--ion-color-primary)"
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${title} on ${provider}`}
          >
            {provider === 'Link' ? 'Open' : provider}
            <ArrowUpRight aria-hidden="true" className="size-4" />
          </a>
        ) : (
          <span className="type-subheadline mb-2.5 flex min-h-6 w-fit items-center">
            {provider}
          </span>
        )
      }
      {...open}
    >
      <IonLabel className="mt-2.5 mb-0 overflow-hidden">
        <div className="flex items-center gap-1.5">
          <h3 className="type-headline truncate">{title}</h3>
          {pinned ? <PinnedMark /> : null}
        </div>
        {/* sr-only: composes with the open verb into "Close <title> player" without changing the visible title. */}
        {loaded ? <p className="sr-only">player</p> : null}
      </IonLabel>
    </Row>
  )
}

import { IonLabel } from '@ionic/react'
import { ArrowUpRight } from 'lucide-react'
import type { LocalRecordingLink } from '../../db/types'
import { Row, type RowAction } from '../../ui/Row'
import { embedFor } from '../player/embed'
import { PlayGlyph, Slot, StopGlyph } from '../player/rowGlyphs'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { displayTitle, providerLabel } from './display'

/**
 * A linked recording as a row shaped like an audio recording's: the row plays it when the
 * provider can be embedded and opens the provider's own site when it cannot, and the line under
 * the title is the link out to that site. The provider is named once, by that link, because a
 * second copy of the name beside it said nothing the link did not.
 */
export function LinkItem({
  link,
  actions,
}: {
  link: LocalRecordingLink
  actions?: readonly RowAction[]
}) {
  const player = usePlayer()
  const title = displayTitle(link)
  const provider = providerLabel(link)
  const embed = embedFor(link)
  const item = { kind: 'link' as const, id: link.id }
  const loaded = isPlaying(player, item)

  let open: { onOpen: () => void; openName: string }
  let glyph
  if (!embed) {
    // Nothing to load in the dock, so the row is the outbound link, like the one under the title.
    open = {
      onOpen: () => window.open(link.url, '_blank', 'noopener,noreferrer'),
      openName: 'Open',
    }
  } else if (loaded) {
    open = { onOpen: () => player.close(), openName: 'Close' }
    glyph = <StopGlyph />
  } else {
    open = { onOpen: () => player.play(item), openName: 'Play' }
    glyph = <PlayGlyph />
  }

  return (
    <Row
      name={title}
      actions={actions}
      start={<Slot>{glyph}</Slot>}
      note={
        <a
          className="type-subheadline inline-flex min-h-6 items-center gap-1 py-0.5 text-(--ion-color-primary)"
          href={link.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${title} on ${provider}`}
        >
          {provider === 'Link' ? 'Open' : provider}
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </a>
      }
      {...open}
    >
      <IonLabel className="my-2.5 overflow-hidden">
        <h3 className="type-headline truncate">{title}</h3>
        {/* sr-only: composes with the open verb into "Close <title> player" without changing the visible title. */}
        {loaded ? <p className="sr-only">player</p> : null}
      </IonLabel>
    </Row>
  )
}

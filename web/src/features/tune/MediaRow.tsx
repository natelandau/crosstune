import { ArrowUpRight, ChevronRight, CloudDownload, ExternalLink } from 'lucide-react'
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import { Button as AriaButton, type Key } from 'react-aria-components'
import { closeLinkName, linkOutText, openOnProviderName } from '../links/linkNames'
import { useLinkRow } from '../links/useLinkRow'
import { openOn } from '../recordings/recordingCopy'
import type { RecordingSort } from '../recordings/arrangeRecordings'
import { downloadingName, openTuneName, RETRY, retryName } from '../recordings/recordingNames'
import { useRecordingRow } from '../recordings/useRecordingRow'
import type { LinkMediaRow, RecordingMediaRow } from './useTuneMedia'
import { PinnedMark } from './PinnedMark'
import { PlayGlyph, StopGlyph } from '../../ui/rowGlyphs'
import { useLatest } from '../../ui/useLatest'
import { useNewTake } from '../capture/useNewTake'
import { Row } from '../../ui/Row'
import { RowList } from '../../ui/RowList'
import { rowActions } from '../../ui/sharedActions'

// The row and its lines answer different taps, so a line that is its own control keeps its
// press from reaching the row, which would play. Other keys still reach the list, so the
// arrows move on from it.
const keepPress = {
  onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onPointerDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onKeyDown: (event: { key: string; stopPropagation: () => void }) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
  },
}

const LINE = 't-secondary inline-flex min-h-6 max-w-full items-center gap-1'

// The list hears a row's tap, so it looks the row's own action up by key.
const MediaOpens = createContext<Map<Key, () => void> | null>(null)

/** The rows of recordings and links, each of which answers its own tap. */
export function MediaList({ label, children }: { label: string; children: ReactNode }) {
  const [opens] = useState(() => new Map<Key, () => void>())
  return (
    <MediaOpens value={opens}>
      <RowList label={label} bleed onAction={(key) => opens.get(key)?.()}>
        {children}
      </RowList>
    </MediaOpens>
  )
}

/**
 * The two-line row recordings and links share: a fixed glyph slot showing the item's state,
 * the title, then its details in secondary. The row is the control, and its name is the verb
 * plus the lines it shows. The loaded item's glyph takes slate.
 */
export function MediaRow({
  id,
  name,
  glyph,
  loaded,
  title,
  pinned,
  details,
  trailing,
  actions,
  dimmed,
  fresh,
  onOpen,
}: {
  id: string
  /** The row's accessible name: the verb, then the lines it shows. */
  name: string
  glyph: ReactNode
  loaded: boolean
  title: string
  pinned: boolean
  details: ReactNode
  trailing?: ReactNode
  actions: Parameters<typeof rowActions>[0]
  dimmed?: boolean
  fresh?: boolean
  onOpen?: () => void
}) {
  const opens = useContext(MediaOpens)
  const onOpenRef = useLatest(onOpen)
  useLayoutEffect(() => {
    opens?.set(id, () => onOpenRef.current?.())
    return () => void opens?.delete(id)
  }, [opens, id, onOpenRef])
  return (
    <Row
      id={id}
      textValue={name}
      stacked
      leading={
        <span
          data-media-glyph
          className={`flex h-(--target) w-6 shrink-0 items-center justify-start ${loaded ? 'text-slate' : 'text-ink-2'}`}
        >
          {glyph}
        </span>
      }
      title={title}
      titleEnd={pinned ? <PinnedMark /> : undefined}
      detail={details}
      trailing={trailing}
      actions={rowActions(actions)}
      dimmed={dimmed}
      fresh={fresh}
      playing={loaded}
    />
  )
}

/** A recording: it plays what this device holds and fetches what it does not. */
export function RecordingRow({
  row: { view, pinned, actions, error },
  onRetry,
  tuneNamedAbove = true,
  sort,
  onOpenTune,
}: {
  row: RecordingMediaRow
  onRetry: (kind: 'upload' | 'transcode') => void
  /** True where a heading above the row already names the recording's tune. */
  tuneNamedAbove?: boolean
  /** The list's sort, which picks the meta line's date. */
  sort?: RecordingSort
  /** Shows the recording's tune as a line that opens it. */
  onOpenTune?: () => void
}) {
  const data = useRecordingRow(view, { tuneNamedAbove, sort, error })
  const fresh = useNewTake(view.recording.id)
  const { title, control, open, retry, origin } = data
  const meta = data.meta.join(' · ')
  const glyph =
    control === 'close' ? (
      <StopGlyph />
    ) : control === 'play' ? (
      <PlayGlyph />
    ) : control === 'download' || control === 'downloading' ? (
      <CloudDownload
        className={`size-5 shrink-0 ${control === 'downloading' || data.offlineDownload ? 'opacity-40' : ''}`}
        aria-hidden
      />
    ) : null
  const name = [open ? `${open.openName} ${title}` : title, meta].filter(Boolean).join(', ')
  return (
    <MediaRow
      id={view.recording.id}
      name={name}
      glyph={
        control === 'downloading' ? (
          <span role="status" aria-label={downloadingName(title)} className="contents">
            {glyph}
          </span>
        ) : (
          glyph
        )
      }
      loaded={data.loaded}
      title={title}
      pinned={pinned}
      dimmed={data.offlineDownload}
      fresh={fresh}
      details={
        <>
          {meta && <span className="t-num block truncate">{meta}</span>}
          {origin && (
            <a
              {...keepPress}
              href={origin.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={openOn(origin.site)}
              className={`${LINE} min-h-(--target)`}
            >
              <span className="truncate">{origin.site}</span>
              <ExternalLink className="size-4 shrink-0" aria-hidden />
            </a>
          )}
          {onOpenTune && view.tuneTitle && (
            <span {...keepPress} className="block">
              <AriaButton
                aria-label={openTuneName(view.tuneTitle)}
                onPress={onOpenTune}
                className={`${LINE} min-h-(--target) text-start`}
              >
                <span className="truncate">{view.tuneTitle}</span>
                <ChevronRight className="size-4 shrink-0" aria-hidden />
              </AriaButton>
            </span>
          )}
          {data.error && <span className="text-danger block">{data.error}</span>}
        </>
      }
      trailing={
        retry && (
          <span {...keepPress} className="contents">
            <AriaButton
              aria-label={retryName(retry, title)}
              onPress={() => onRetry(retry)}
              className="t-body text-slate min-h-(--target-control) shrink-0 px-2"
            >
              {RETRY}
            </AriaButton>
          </span>
        )
      }
      actions={actions}
      onOpen={open?.onOpen}
    />
  )
}

/** A link to the tune elsewhere: it plays in the dock when it can, else opens its site. */
export function LinkRow({ row: { link, pinned, actions } }: { row: LinkMediaRow }) {
  const { title, provider, control, href, loaded, open } = useLinkRow(link)
  const verb =
    control === 'close' ? closeLinkName(title) : open ? `${open.openName} ${title}` : title
  return (
    <MediaRow
      id={link.id}
      name={`${verb}, ${href ? linkOutText(provider) : provider}`}
      glyph={control === 'close' ? <StopGlyph /> : control === 'play' ? <PlayGlyph /> : null}
      loaded={loaded}
      title={title}
      pinned={pinned}
      details={
        href ? (
          <a
            {...keepPress}
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={openOnProviderName(title, provider)}
            className={`${LINE} text-slate min-h-(--target)`}
          >
            {linkOutText(provider)}
            <ArrowUpRight className="size-4 shrink-0" aria-hidden />
          </a>
        ) : (
          <span className={LINE}>{provider}</span>
        )
      }
      actions={actions}
      onOpen={open?.onOpen}
    />
  )
}

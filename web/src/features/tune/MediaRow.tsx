import { ArrowUpRight, ExternalLink } from 'lucide-react'
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import type { Key } from 'react-aria-components'
import { closeLinkName, linkOutText, openOnProviderName } from '../links/linkNames'
import { useLinkRow } from '../links/useLinkRow'
import { openOn, SUBSCRIBE_TO_PLAY } from '../recordings/recordingCopy'
import type { RecordingSort } from '../recordings/arrangeRecordings'
import {
  downloadingName,
  openTuneName,
  RETRY,
  retryName,
  slotName,
} from '../recordings/recordingNames'
import { useRecordingRow } from '../recordings/useRecordingRow'
import type { PlayOrigin } from '../player/playLog'
import type { PremiumEntry } from '../plan/PremiumSheetProvider'
import type { LinkMediaRow, RecordingMediaRow } from './useTuneMedia'
import type { StorageUsage } from '../../db/meta'
import { PinnedMark } from './PinnedMark'
import {
  ActionSlot,
  LinkControlGlyph,
  RecordingControlGlyph,
  RING_ROW_HOVER,
  SlotButton,
} from '../../ui/rowGlyphs'
import { useOpenRecordingPage } from '../player/recordingPageOpener'
import type { Source } from '../../usage/events'
import { useLatest } from '../../ui/useLatest'
import { useNewRecording } from '../capture/useNewRecording'
import { Button } from '../../ui/Button'
import { Row } from '../../ui/Row'
import { RowList } from '../../ui/RowList'
import { rowActions } from '../../ui/sharedActions'
import { PressableRow } from '../../ui/PressableRow'

// The row, its lines, and its slot answer different taps, so a line or slot that is its own
// control keeps its press from reaching the row. Other keys still reach the list, so the
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
 * The two-line row recordings and links share: the title, its details in secondary, then a
 * trailing slot that holds a glyph for the item's state, or a control that takes its place.
 */
function MediaRow({
  id,
  name,
  glyph,
  loaded,
  title,
  pinned,
  details,
  description,
  action,
  actions,
  dimmed,
  fresh,
  onOpen,
}: {
  id: string
  /** The row's accessible name: the lines it shows, after the action label where the row's
   * tap is the slot's action. */
  name: string
  /** Stands for the row's own tap in the slot, where no `action` takes its place. */
  glyph?: ReactNode
  loaded: boolean
  title: string
  pinned: boolean
  details: ReactNode
  /** Heard after the row's name. */
  description?: string
  /** A control that takes the glyph's slot, such as a recording's play or a stuck one's Retry. */
  action?: ReactNode
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
      title={title}
      titleEnd={pinned ? <PinnedMark /> : undefined}
      detail={details}
      description={description}
      trailing={
        action ?? (
          <ActionSlot data-media-glyph className={RING_ROW_HOVER}>
            {glyph}
          </ActionSlot>
        )
      }
      actions={rowActions(actions)}
      dimmed={dimmed}
      fresh={fresh}
      playing={loaded}
    />
  )
}

/**
 * A recording: its tap opens the recording's page, and its slot plays what this device holds
 * and fetches what it does not.
 */
export function RecordingRow({
  row: { view, pinned, actions, error },
  onRetry,
  tuneNamedAbove = true,
  sort,
  onOpenTune,
  playOrigin,
  pageSource = 'tune',
  premiumFrom,
  storage,
}: {
  row: RecordingMediaRow
  onRetry: (kind: 'upload' | 'transcode') => void
  /** True where a heading above the row already names the recording's tune. */
  tuneNamedAbove?: boolean
  /** The list's sort, which picks the meta line's date. */
  sort?: RecordingSort
  /** Shows the recording's tune as a line that opens it. */
  onOpenTune?: () => void
  /** Where a play from the row counts as asked for; a tune's page by default. */
  playOrigin?: PlayOrigin
  /** Where the recording's page counts as opened from; a tune's page by default. */
  pageSource?: Source
  /** Where a press on a disabled row's slot counts as opening the Plan sheet from. */
  premiumFrom?: PremiumEntry
  /** The server's storage report, read once by the list rather than by each row. */
  storage: StorageUsage | null
}) {
  const data = useRecordingRow(view, {
    tuneNamedAbove,
    sort,
    error,
    origin: playOrigin,
    premiumFrom,
    storage,
  })
  const fresh = useNewRecording(view.recording.id)
  const openPage = useOpenRecordingPage()
  const { title, control, slot, retry, origin } = data
  const meta = data.meta.join(' · ')
  const glyph = <RecordingControlGlyph control={control} offline={data.offlineDownload} />
  return (
    <MediaRow
      id={view.recording.id}
      name={[title, meta].filter(Boolean).join(', ')}
      loaded={data.loaded}
      title={title}
      pinned={pinned}
      dimmed={data.offlineDownload || data.disabled}
      description={data.disabled ? SUBSCRIBE_TO_PLAY : undefined}
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
              <PressableRow
                variant="line"
                aria-label={openTuneName(view.tuneTitle)}
                onPress={onOpenTune}
                chevron
              >
                <span className="truncate">{view.tuneTitle}</span>
              </PressableRow>
            </span>
          )}
          {data.error && <span className="text-danger block">{data.error}</span>}
        </>
      }
      action={
        retry ? (
          <ActionSlot {...keepPress} worded>
            <Button label={RETRY} name={retryName(retry, title)} onPress={() => onRetry(retry)} />
          </ActionSlot>
        ) : control === 'downloading' ? (
          <ActionSlot data-media-glyph role="status" aria-label={downloadingName(title)}>
            {glyph}
          </ActionSlot>
        ) : slot && control !== 'none' ? (
          <span {...keepPress} data-media-glyph className="contents">
            <SlotButton name={slotName(control, title)} onPress={slot}>
              {glyph}
            </SlotButton>
          </span>
        ) : (
          <ActionSlot />
        )
      }
      actions={actions}
      onOpen={
        openPage
          ? () => openPage(view.recording.id, { tuneId: view.tuneId, source: pageSource })
          : undefined
      }
    />
  )
}

/** A link to the tune elsewhere: it plays in the dock when it can, else opens its site. */
export function LinkRow({ row: { link, pinned, actions } }: { row: LinkMediaRow }) {
  const { title, provider, control, href, reportOpened, loaded, open } = useLinkRow(link)
  const actionLabel =
    control === 'close' ? closeLinkName(title) : open ? `${open.openName} ${title}` : title
  return (
    <MediaRow
      id={link.id}
      name={`${actionLabel}, ${href ? linkOutText(provider) : provider}`}
      glyph={<LinkControlGlyph control={control} />}
      loaded={loaded}
      title={title}
      pinned={pinned}
      details={
        href ? (
          <a
            {...keepPress}
            onClick={(event) => {
              keepPress.onClick(event)
              reportOpened()
            }}
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={openOnProviderName(title, provider)}
            className={`${LINE} text-primary min-h-(--target)`}
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

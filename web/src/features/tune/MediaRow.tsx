import { ArrowUpRight, ExternalLink, ListChecks } from 'lucide-react'
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import type { Key, Selection } from 'react-aria-components'
import { closeLinkName, linkOutText, openOnProviderName } from '../links/linkNames'
import { useLinkRow } from '../links/useLinkRow'
import { openOn } from '../recordings/recordingCopy'
import type { RecordingSort } from '../recordings/arrangeRecordings'
import {
  downloadingName,
  openTuneName,
  RETRY,
  retryName,
  slotName,
} from '../recordings/recordingNames'
import { useRecordingRow } from '../recordings/useRecordingRow'
import { applySelection } from '../selection/applySelection'
import { SELECT } from '../selection/selectionCopy'
import type { SelectionMode } from '../selection/useSelectionMode'
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
import type { Source } from '../../usage/events'
import { useLatest } from '../../ui/useLatest'
import { useNewRecording } from '../capture/useNewRecording'
import { Button } from '../../ui/Button'
import { Row, type RowAction } from '../../ui/Row'
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

/**
 * The rows of recordings and links, each of which answers its own tap. While the screen
 * selects, a tap toggles the row's selection instead.
 */
export function MediaList({
  label,
  children,
  selection,
}: {
  label: string
  children: ReactNode
  /** The screen's selection, which the rows join while it is on. */
  selection?: SelectionMode
}) {
  const [opens] = useState(() => new Map<Key, () => void>())
  return (
    <MediaOpens value={opens}>
      <RowList
        label={label}
        bleed
        {...(selection?.active
          ? {
              selectionMode: 'multiple',
              selectionBehavior: 'toggle',
              selectedKeys: new Set(selection.selected),
              onSelectionChange: (keys: Selection) => applySelection(selection, keys),
            }
          : { onAction: (key: Key) => opens.get(key)?.() })}
      >
        {children}
      </RowList>
    </MediaOpens>
  )
}

/** A detail line as plain text. */
function PlainLine({ children }: { children: string }) {
  return (
    <span className={`${LINE} min-h-(--target)`}>
      <span className="truncate">{children}</span>
    </span>
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
  action,
  actions,
  menu,
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
  /** A control that takes the glyph's slot, such as a recording's play or a stuck one's Retry. */
  action?: ReactNode
  actions: RowAction[]
  /** The row's menu, when it holds more than `actions`. */
  menu?: RowAction[]
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
      trailing={
        action ?? (
          <ActionSlot data-media-glyph className={RING_ROW_HOVER}>
            {glyph}
          </ActionSlot>
        )
      }
      actions={actions}
      menu={menu}
      dimmed={dimmed}
      fresh={fresh}
      playing={loaded}
    />
  )
}

/**
 * A recording: its tap opens the recording's page, or on a free plan the Plan sheet for it, and
 * its slot plays what this device holds and fetches what it does not.
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
  selecting = false,
  onSelect,
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
  /** Where a free plan's press on the row or its play counts as opening the Plan sheet from. */
  premiumFrom?: PremiumEntry
  /** The server's storage report, read once by the list rather than by each row. */
  storage: StorageUsage | null
  /** The screen is selecting, and acts on its rows from its own bar, so the row offers nothing. */
  selecting?: boolean
  /** Opens selection with this row selected, from the row's menu. */
  onSelect?: () => void
}) {
  const data = useRecordingRow(view, {
    tuneNamedAbove,
    sort,
    error,
    origin: playOrigin,
    premiumFrom,
    pageSource,
    storage,
  })
  const fresh = useNewRecording(view.recording.id)
  const { title, control, slot, retry, origin } = data
  const meta = data.meta.join(' · ')
  const glyph = <RecordingControlGlyph control={control} offline={data.offlineDownload} />
  const rowMenu = selecting ? [] : rowActions(actions)
  return (
    <MediaRow
      id={view.recording.id}
      name={[title, meta].filter(Boolean).join(', ')}
      loaded={data.loaded}
      title={title}
      pinned={pinned}
      dimmed={data.offlineDownload || data.disabled}
      fresh={fresh}
      details={
        <>
          {meta && <span className="t-num block truncate">{meta}</span>}
          {/* While selecting a tap anywhere on the row toggles it, so the lines show as text. */}
          {origin && selecting ? (
            <PlainLine>{origin.site}</PlainLine>
          ) : origin ? (
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
          ) : null}
          {onOpenTune && view.tuneTitle && selecting ? (
            <PlainLine>{view.tuneTitle}</PlainLine>
          ) : onOpenTune && view.tuneTitle ? (
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
          ) : null}
          {data.error && <span className="text-danger block">{data.error}</span>}
        </>
      }
      action={
        selecting ? (
          <ActionSlot data-media-glyph>{control === 'none' ? null : glyph}</ActionSlot>
        ) : retry ? (
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
      actions={rowMenu}
      menu={
        selecting
          ? []
          : onSelect && [
              { id: 'select', label: SELECT, icon: ListChecks, onAction: onSelect },
              ...rowMenu,
            ]
      }
      onOpen={data.open}
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
      actions={rowActions(actions)}
      onOpen={open?.onOpen}
    />
  )
}

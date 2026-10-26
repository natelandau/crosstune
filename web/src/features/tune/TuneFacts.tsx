import { ChevronDown } from 'lucide-react'
import { Fragment, useRef, useState, type ReactNode } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { Link } from 'react-router'
import { usePane } from '../../layout/pane'
import type { Instrument } from '../../api/vocabulary'
import { addedDay } from '../../text/format'
import { CAPSULE_HIT } from '../../ui/Capsule'
import { FIELD_LABEL, FIELD_VALUE_SHAPE } from '../../ui/form/FieldRow'
import { ErrorLine } from '../../ui/ErrorLine'
import { Group } from '../../ui/form/Group'
import { ROW_PRESS } from '../../ui/press'
import { useElementSize } from '../../ui/useElementSize'
import { ADD_TO_LIST } from '../lists/listPickerCopy'
import { FactEditor, type FactEditorProps } from './FactEditor'
import { RAIL_TOP, RAIL_WIDTH } from './factsLayout'
import { FactEditorBody } from './factEditors'
import {
  ABOUT_GROUP,
  ADD_VALUE,
  factRowName,
  ADDED_ON,
  DETAILS_GROUP,
  FACTS_LABEL,
  LEARNED_GROUP,
  LISTS_GROUP,
  MORE_DETAILS,
} from './factCopy'
import { cardRows, factRows, type FactId, type FactRow } from './factRows'
import { valuesFromRows } from './tuneFormValues'
import { useFactWrite } from './useFactWrite'
import type { TuneView } from './useTune'
import type { TuneListMembership } from './useTuneScreen'

interface TuneFactsProps {
  view: TuneView
  instruments: ReadonlySet<Instrument>
  /** The rail ends with the lists and the day added; where the card shows, the page does. */
  inLists: TuneListMembership[]
  /** The tune's creation instant. */
  createdAt: string
  layout: 'rail' | 'card'
  onAddToList: () => void
}

const ROW_SHAPE = `${ROW_PRESS} flex min-h-(--target) w-full items-center gap-3 px-4 text-start t-body`
/**
 * A rail row: inset, so its wash reads as a rounded shape on the open ground. Its label and
 * value are columns that each wrap on their own, set on their first baselines; the padding
 * centers a single line in the row's target height.
 */
const RAIL_ROW_SHAPE = `${ROW_PRESS} mx-2 flex min-h-(--target) items-baseline gap-3 rounded-(--radius-row) px-2 py-[calc((var(--target)_-_1.45em)/2)] text-start t-body`
/**
 * The rail's label column, in the label's own size: wide enough for "Time signature" on one
 * line, so a longer label such as "5-string banjo tuning" wraps to a second.
 */
const RAIL_LABEL = 't-secondary text-ink-2 w-[7.5em] shrink-0 break-words'
/** A group header: quieter than a row by its smaller size, never by fading. */
const RAIL_HEADER = 't-caption text-ink-2 px-4 pb-1'

export function TuneFacts({
  view,
  instruments,
  inLists,
  createdAt,
  layout,
  onAddToList,
}: TuneFactsProps) {
  const [openId, setOpenId] = useState<FactId | null>(null)
  const write = useFactWrite(view.tune.id)
  const noPane = useRef<HTMLElement>(null)
  const paneHeight = useElementSize(usePane()?.scroller ?? noPane).height
  const rows = factRows(view, instruments)
  const stored = valuesFromRows(view.tune, view.userTune)

  const renderRow = (row: FactRow) => {
    const isOpen = openId === row.id
    return (
      <FactRowEditor
        key={row.id}
        row={row}
        isOpen={isOpen}
        rail={layout === 'rail'}
        onOpen={() => setOpenId(row.id)}
        editor={{
          isOpen: true,
          onOpenChange: (next) => {
            if (!next) setOpenId(null)
          },
          stored,
          onCommit: write.write,
        }}
      >
        <FactEditorBody id={row.id} view={view} write={write} />
      </FactRowEditor>
    )
  }

  if (layout === 'rail') {
    const groups = [
      { header: DETAILS_GROUP, rows: rows.filter((r) => r.group === 'details') },
      { header: ABOUT_GROUP, rows: rows.filter((r) => r.group === 'about') },
      { header: LEARNED_GROUP, rows: rows.filter((r) => r.group === 'learned') },
    ]
    // The hairline spans the content's height; the rail inside sticks under the pane bar, so
    // it stays in view while a long column scrolls. A rail taller than the pane, under its bar,
    // scrolls on its own, so its last groups are never out of reach.
    return (
      <div className="border-hairline border-s">
        <aside
          aria-label={FACTS_LABEL}
          className="sticky top-11 flex max-h-[calc(100dvh-2.75rem)] flex-col overflow-y-auto overscroll-contain pb-4"
          style={{
            width: RAIL_WIDTH,
            maxHeight: paneHeight > 0 ? `calc(${paneHeight}px - 2.75rem)` : undefined,
          }}
        >
          {groups.map((group, index) => (
            <Fragment key={group.header}>
              <h2
                className={RAIL_HEADER}
                style={{ paddingTop: index === 0 ? RAIL_TOP : '1.25rem' }}
              >
                {group.header}
              </h2>
              {group.rows.map(renderRow)}
            </Fragment>
          ))}
          <ErrorLine error={write.error} place="field" />
          <h2 className={`${RAIL_HEADER} pt-5`}>{LISTS_GROUP}</h2>
          <div className="px-4 pt-1">
            <TuneLists inLists={inLists} onAddToList={onAddToList} />
          </div>
          <AddedLine createdAt={createdAt} className="px-4 pt-5" />
        </aside>
      </div>
    )
  }

  return <FactsCard rows={rows} renderRow={renderRow} error={write.error} />
}

/** The lists a tune is in, as capsules that open each list, then a way to add it to another. */
export function TuneLists({
  inLists,
  onAddToList,
}: {
  inLists: TuneListMembership[]
  onAddToList: () => void
}) {
  return (
    <ul className="flex flex-wrap items-center gap-2">
      {inLists.map((list) => (
        <li key={list.id}>
          <Link
            to={`/lists/${list.id}`}
            className={`t-secondary bg-field text-ink inline-flex h-[min(2rem,var(--target-filter))] items-center rounded-(--radius-capsule) px-3 ${CAPSULE_HIT}`}
          >
            {list.name}
          </Link>
        </li>
      ))}
      <li>
        <AriaButton
          onPress={onAddToList}
          className={`t-secondary text-ink-2 hover:bg-field inline-flex h-[min(2rem,var(--target-filter))] items-center rounded-(--radius-capsule) px-3 ${CAPSULE_HIT}`}
        >
          {ADD_TO_LIST}
        </AriaButton>
      </li>
    </ul>
  )
}

/** The footnote that ends a tune's facts: the day it joined the catalog. */
export function AddedLine({ createdAt, className }: { createdAt: string; className: string }) {
  return (
    <p className={`t-caption text-ink-2 font-normal ${className}`}>
      {ADDED_ON(addedDay(createdAt))}
    </p>
  )
}

function FactsCard({
  rows,
  renderRow,
  error,
}: {
  rows: FactRow[]
  renderRow: (row: FactRow) => ReactNode
  /** Why the last write from a row was refused. */
  error: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const { shown, more } = cardRows(rows)
  const learned = more.filter((r) => r.group === 'learned')
  return (
    <section aria-label={FACTS_LABEL}>
      <Group error={error ?? undefined}>
        {shown.map(renderRow)}
        <AriaButton
          aria-expanded={expanded}
          onPress={() => setExpanded((prev) => !prev)}
          className={ROW_SHAPE}
        >
          <span className="flex-1">{MORE_DETAILS}</span>
          <ChevronDown
            className={`text-ink-2 size-4 transition-transform duration-(--dur-short) ease-(--ease) ${expanded ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </AriaButton>
        {expanded && more.filter((r) => r.group !== 'learned').map(renderRow)}
      </Group>
      {expanded && learned.length > 0 && (
        <Group header={LEARNED_GROUP}>{learned.map(renderRow)}</Group>
      )}
    </section>
  )
}

function FactRowEditor({
  row,
  isOpen,
  rail,
  onOpen,
  editor,
  children,
}: {
  row: FactRow
  isOpen: boolean
  /** Two wrapping columns on a rounded row, rather than the card's grouped row. */
  rail: boolean
  onOpen: () => void
  editor: Omit<FactEditorProps, 'label' | 'triggerRef' | 'children'>
  children: ReactNode
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <>
      <AriaButton
        ref={trigger}
        aria-label={factRowName(row.label, row.text)}
        aria-haspopup="dialog"
        onPress={onOpen}
        className={rail ? RAIL_ROW_SHAPE : ROW_SHAPE}
      >
        <span className={rail ? RAIL_LABEL : FIELD_LABEL}>{row.label}</span>
        <span
          className={`${rail ? 'min-w-0 flex-1 break-words' : FIELD_VALUE_SHAPE} ${row.text === null ? 'text-ink-2' : 'text-ink'}`}
        >
          {row.text ?? ADD_VALUE}
        </span>
      </AriaButton>
      {isOpen && (
        <FactEditor {...editor} label={row.label} triggerRef={trigger}>
          {children}
        </FactEditor>
      )}
    </>
  )
}

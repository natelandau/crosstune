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
import { AttributeEditor, type AttributeEditorProps } from './AttributeEditor'
import { COLUMN_TOP, COLUMN_WIDTH } from './attributesLayout'
import { AttributeEditorBody } from './attributeEditors'
import {
  ABOUT_GROUP,
  ADD_VALUE,
  attributeRowName,
  ADDED_ON,
  DETAILS_GROUP,
  ATTRIBUTES_LABEL,
  LEARNED_GROUP,
  LISTS_GROUP,
  MORE_DETAILS,
} from './attributeCopy'
import { cardRows, attributeRows, type AttributeId, type AttributeRow } from './attributeRows'
import { valuesFromRows } from './tuneFormValues'
import { useAttributeWrite } from './useAttributeWrite'
import type { TuneView } from './useTune'
import type { TuneListMembership } from './useTuneScreen'

interface TuneAttributesProps {
  view: TuneView
  instruments: ReadonlySet<Instrument>
  /** The attributes column ends with the lists and the day added; where the card shows, the page does. */
  inLists: TuneListMembership[]
  /** The tune's creation instant. */
  createdAt: string
  layout: 'column' | 'card'
  onAddToList: () => void
}

const ROW_SHAPE = `${ROW_PRESS} flex min-h-(--target) w-full items-center gap-3 px-4 text-start t-body`
/**
 * A row in the attributes column: inset, so its tint reads as a rounded shape on the open page. Its label and
 * value are columns that each wrap on their own, set on their first baselines; the padding
 * centers a single line in the row's target height.
 */
const COLUMN_ROW_SHAPE = `${ROW_PRESS} mx-2 flex min-h-(--target) items-baseline gap-3 rounded-(--radius-row) px-2 py-[calc((var(--target)_-_1.45em)/2)] text-start t-body`
/**
 * The attributes column's label width, in the label's own size: wide enough for "Time signature" on one
 * line, so a longer label such as "5-string banjo tuning" wraps to a second.
 */
const COLUMN_LABEL = 't-secondary text-secondary w-[7.5em] shrink-0 break-words'
/** A group header: quieter than a row by its smaller size, never by fading. */
const COLUMN_HEADER = 't-caption text-secondary px-4 pb-1'

export function TuneAttributes({
  view,
  instruments,
  inLists,
  createdAt,
  layout,
  onAddToList,
}: TuneAttributesProps) {
  const [openId, setOpenId] = useState<AttributeId | null>(null)
  const write = useAttributeWrite(view.tune.id)
  const noPane = useRef<HTMLElement>(null)
  const paneHeight = useElementSize(usePane()?.scroller ?? noPane).height
  const rows = attributeRows(view, instruments)
  const stored = valuesFromRows(view.tune, view.userTune)

  const renderRow = (row: AttributeRow) => {
    const isOpen = openId === row.id
    return (
      <AttributeRowEditor
        key={row.id}
        row={row}
        isOpen={isOpen}
        column={layout === 'column'}
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
        <AttributeEditorBody id={row.id} view={view} write={write} />
      </AttributeRowEditor>
    )
  }

  if (layout === 'column') {
    const groups = [
      { header: DETAILS_GROUP, rows: rows.filter((r) => r.group === 'details') },
      { header: ABOUT_GROUP, rows: rows.filter((r) => r.group === 'about') },
      { header: LEARNED_GROUP, rows: rows.filter((r) => r.group === 'learned') },
    ]
    // The hairline spans the content's height; the attributes column inside sticks under the
    // pane bar, so it stays in view while long content scrolls. An attributes column taller than
    // the pane, under its bar, scrolls on its own, so its last groups are never out of reach.
    return (
      <div className="border-default border-s">
        <aside
          aria-label={ATTRIBUTES_LABEL}
          className="sticky top-11 flex max-h-[calc(100dvh-2.75rem)] flex-col overflow-y-auto overscroll-contain pb-4"
          style={{
            width: COLUMN_WIDTH,
            maxHeight: paneHeight > 0 ? `calc(${paneHeight}px - 2.75rem)` : undefined,
          }}
        >
          {groups.map((group, index) => (
            <Fragment key={group.header}>
              <h2
                className={COLUMN_HEADER}
                style={{ paddingTop: index === 0 ? COLUMN_TOP : '1.25rem' }}
              >
                {group.header}
              </h2>
              {group.rows.map(renderRow)}
            </Fragment>
          ))}
          <ErrorLine error={write.error} place="field" />
          <h2 className={`${COLUMN_HEADER} pt-5`}>{LISTS_GROUP}</h2>
          <div className="px-4 pt-1">
            <TuneLists inLists={inLists} onAddToList={onAddToList} />
          </div>
          <AddedLine createdAt={createdAt} className="px-4 pt-5" />
        </aside>
      </div>
    )
  }

  return <AttributesCard rows={rows} renderRow={renderRow} error={write.error} />
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
            className={`t-secondary bg-field text-primary inline-flex h-[min(2rem,var(--target-filter))] items-center rounded-(--radius-capsule) px-3 ${CAPSULE_HIT}`}
          >
            {list.name}
          </Link>
        </li>
      ))}
      <li>
        <AriaButton
          onPress={onAddToList}
          className={`t-secondary text-secondary hover:bg-field inline-flex h-[min(2rem,var(--target-filter))] items-center rounded-(--radius-capsule) px-3 ${CAPSULE_HIT}`}
        >
          {ADD_TO_LIST}
        </AriaButton>
      </li>
    </ul>
  )
}

/** The footnote that ends a tune's attributes: the day it joined the catalog. */
export function AddedLine({ createdAt, className }: { createdAt: string; className: string }) {
  return (
    <p className={`t-caption text-secondary font-normal ${className}`}>
      {ADDED_ON(addedDay(createdAt))}
    </p>
  )
}

function AttributesCard({
  rows,
  renderRow,
  error,
}: {
  rows: AttributeRow[]
  renderRow: (row: AttributeRow) => ReactNode
  /** Why the last write from a row was refused. */
  error: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const { shown, more } = cardRows(rows)
  const learned = more.filter((r) => r.group === 'learned')
  return (
    <section aria-label={ATTRIBUTES_LABEL}>
      <Group error={error ?? undefined}>
        {shown.map(renderRow)}
        <AriaButton
          aria-expanded={expanded}
          onPress={() => setExpanded((prev) => !prev)}
          className={ROW_SHAPE}
        >
          <span className="flex-1">{MORE_DETAILS}</span>
          <ChevronDown
            className={`text-secondary size-4 transition-transform duration-(--dur-short) ease-(--ease) ${expanded ? 'rotate-180' : ''}`}
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

function AttributeRowEditor({
  row,
  isOpen,
  column,
  onOpen,
  editor,
  children,
}: {
  row: AttributeRow
  isOpen: boolean
  /** Two wrapping columns on a rounded row, rather than the card's grouped row. */
  column: boolean
  onOpen: () => void
  editor: Omit<AttributeEditorProps, 'label' | 'triggerRef' | 'children'>
  children: ReactNode
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  return (
    <>
      <AriaButton
        ref={trigger}
        aria-label={attributeRowName(row.label, row.text)}
        aria-haspopup="dialog"
        onPress={onOpen}
        className={column ? COLUMN_ROW_SHAPE : ROW_SHAPE}
      >
        <span className={column ? COLUMN_LABEL : FIELD_LABEL}>{row.label}</span>
        <span
          className={`${column ? 'min-w-0 flex-1 break-words' : FIELD_VALUE_SHAPE} ${row.text === null ? 'text-secondary' : 'text-primary'}`}
        >
          {row.text ?? ADD_VALUE}
        </span>
      </AriaButton>
      {isOpen && (
        <AttributeEditor {...editor} label={row.label} triggerRef={trigger}>
          {children}
        </AttributeEditor>
      )}
    </>
  )
}

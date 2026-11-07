import { ChevronDown } from 'lucide-react'
import { Fragment, useState, type ReactNode, type Ref } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { usePaneHeight } from '../../layout/pane'
import { ErrorLine } from '../ErrorLine'
import { Group } from '../form/Group'
import { COLUMN_TOP } from './attributesLayout'
import { MORE_DETAILS } from './attributesCopy'
import {
  AttributeRowButton,
  AttributeRowEditor,
  ReadOnlyRow,
  ROW_SHAPE,
} from './AttributeRowEditor'

export interface AttributeColumnRow {
  id: string
  label: string
  /** Null when there is no value, so the row shows the empty text. */
  text: string | null
  /** The `id` of the group the row sits under. */
  group: string
  /** Shown as text, with no editor to open. */
  readOnly?: boolean
  /**
   * The editor the row opens, in place of one from `editorFor`, for one that saves outside
   * `onCommit`. It closes with `onClose`, and calls `onWrite` as it writes, so a refusal shows
   * beside the row.
   */
  ownEditor?: (edit: { onClose: () => void; onWrite: () => void }) => ReactNode
  /** Content set under the row, such as a map. */
  below?: ReactNode
}

export interface AttributeGroup {
  id: string
  /** Left out for a group whose one row already names it; the space before it stays. */
  heading?: string
  /** In the card, rows folded away from this group show under their own heading. */
  cardSection?: boolean
}

/** A group header: the content column's section heading step, so both columns head alike. */
export const COLUMN_HEADER = 't-heading text-primary px-4 pb-1'

/**
 * The attributes of one page: a sticky column of headed groups beside wide content, or a card
 * that folds all but a few rows behind "More details". A row opens an editor in a popover, or in
 * a sheet where `sheetFor` says so.
 */
export function AttributesColumn<R extends AttributeColumnRow, P extends object>({
  ref,
  label,
  layout,
  groups,
  rows,
  emptyText,
  stored,
  onCommit,
  editorFor,
  sheetFor,
  fold,
  footer,
  error,
  openId: shownId,
  onOpenIdChange,
}: {
  /** The column or the card, whichever shows. */
  ref?: Ref<HTMLElement>
  /** The region's accessible name. */
  label: string
  layout: 'column' | 'card'
  groups: AttributeGroup[]
  rows: R[]
  /** What a row with no value says. */
  emptyText: string
  /** The values an edit is compared with, so an edit that changes none of them writes nothing. */
  stored: P
  onCommit: (patch: P) => void
  /** The body of the editor a row opens. */
  editorFor: (row: R) => ReactNode
  /** True for a row whose editor opens as a sheet on every frame. */
  sheetFor?: (row: R) => boolean
  /** Splits the card's rows into those shown up front and those behind "More details". */
  fold?: (rows: R[]) => { shown: R[]; more: R[] }
  /** Set under the last group of the column; the card leaves it to the page. */
  footer?: ReactNode
  /** Why the last write from a row was refused. */
  error?: string | null
  /** The row whose editor is open, for a page that also opens one from elsewhere. */
  openId?: string | null
  onOpenIdChange?: (id: string | null) => void
}) {
  const [ownOpenId, setOwnOpenId] = useState<string | null>(null)
  const openId = shownId === undefined ? ownOpenId : shownId
  const setOpenId = (id: string | null) => {
    setOwnOpenId(id)
    onOpenIdChange?.(id)
  }
  // The group whose row last saved, so the card shows a refusal beside the row it belongs to.
  const [savedGroup, setSavedGroup] = useState<string | null>(null)
  const paneHeight = usePaneHeight()
  const column = layout === 'column'

  const renderRow = (row: R) => {
    const face = { label: row.label, text: row.text, emptyText, column }
    return (
      <Fragment key={row.id}>
        {row.readOnly ? (
          <ReadOnlyRow {...face} />
        ) : row.ownEditor ? (
          <>
            <AttributeRowButton {...face} onPress={() => setOpenId(row.id)} />
            {openId === row.id &&
              row.ownEditor({
                onClose: () => setOpenId(null),
                onWrite: () => setSavedGroup(row.group),
              })}
          </>
        ) : (
          <AttributeRowEditor
            {...face}
            isOpen={openId === row.id}
            onOpen={() => setOpenId(row.id)}
            editor={{
              isOpen: true,
              onOpenChange: (next) => {
                if (!next) setOpenId(null)
              },
              stored,
              onCommit: (patch) => {
                setSavedGroup(row.group)
                onCommit(patch)
              },
              forceSheet: sheetFor?.(row),
            }}
          >
            {editorFor(row)}
          </AttributeRowEditor>
        )}
        {row.below}
      </Fragment>
    )
  }

  if (column) {
    // The hairline spans the content's height; the attributes column inside sticks under the
    // pane bar, so it stays in view while long content scrolls. An attributes column taller than
    // the pane, under its bar, scrolls on its own, so its last groups are never out of reach.
    return (
      <div ref={ref as Ref<HTMLDivElement>} className="border-default border-s">
        <aside
          aria-label={label}
          className="@container sticky top-11 flex max-h-[calc(100dvh-2.75rem)] flex-col overflow-y-auto overscroll-contain pb-6"
          style={{
            maxHeight: paneHeight > 0 ? `calc(${paneHeight}px - 2.75rem)` : undefined,
          }}
        >
          {groups.map((group, index) => (
            <Fragment key={group.id}>
              {group.heading ? (
                <h2
                  className={index === 0 ? COLUMN_HEADER : `${COLUMN_HEADER} pt-6`}
                  style={index === 0 ? { paddingTop: COLUMN_TOP } : undefined}
                >
                  {group.heading}
                </h2>
              ) : (
                <div
                  className={index === 0 ? undefined : 'pt-6'}
                  style={index === 0 ? { paddingTop: COLUMN_TOP } : undefined}
                />
              )}
              {rows.filter((r) => r.group === group.id).map(renderRow)}
            </Fragment>
          ))}
          <ErrorLine error={error ?? null} place="field" />
          {footer}
        </aside>
      </div>
    )
  }

  return (
    <AttributesCard
      ref={ref}
      label={label}
      groups={groups}
      rows={rows}
      fold={fold}
      renderRow={renderRow}
      error={error ?? null}
      savedGroup={savedGroup}
    />
  )
}

function AttributesCard<R extends AttributeColumnRow>({
  ref,
  label,
  groups,
  rows,
  fold,
  renderRow,
  error,
  savedGroup,
}: {
  ref?: Ref<HTMLElement>
  label: string
  groups: AttributeGroup[]
  rows: R[]
  fold?: (rows: R[]) => { shown: R[]; more: R[] }
  renderRow: (row: R) => ReactNode
  error: string | null
  /** The group whose row last saved; a separate card per group shows the refusal in it. */
  savedGroup: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const sections = groups.filter((g) => g.cardSection)
  if (!fold) {
    // With nothing folded, each group is a card of its own; a refusal shows in the card whose
    // row saved, the first card before any has.
    const errorGroup = savedGroup ?? groups.find((g) => rows.some((r) => r.group === g.id))?.id
    return (
      <section ref={ref} aria-label={label}>
        {groups.map((group) => {
          const own = rows.filter((r) => r.group === group.id)
          return own.length > 0 ? (
            <Group
              key={group.id}
              header={group.cardSection ? group.heading : undefined}
              error={group.id === errorGroup ? (error ?? undefined) : undefined}
            >
              {own.map(renderRow)}
            </Group>
          ) : null
        })}
      </section>
    )
  }
  const { shown, more } = fold(rows)
  const inSection = (row: R) => sections.some((g) => g.id === row.group)
  return (
    <section ref={ref} aria-label={label}>
      <Group error={error ?? undefined}>
        {shown.map(renderRow)}
        {more.length > 0 && (
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
        )}
        {expanded && more.filter((r) => !inSection(r)).map(renderRow)}
      </Group>
      {expanded &&
        sections.map((group) => {
          const own = more.filter((r) => r.group === group.id)
          return own.length > 0 ? (
            <Group key={group.id} header={group.heading}>
              {own.map(renderRow)}
            </Group>
          ) : null
        })}
    </section>
  )
}

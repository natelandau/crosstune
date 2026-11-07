import { Button as AriaButton } from 'react-aria-components'
import { Link } from 'react-router'
import type { Instrument } from '../../api/vocabulary'
import { addedDay } from '../../text/format'
import { AttributesColumn, COLUMN_HEADER } from '../../ui/attributes/AttributesColumn'
import { CAPSULE_HIT } from '../../ui/Capsule'
import { ADD_TO_LIST } from '../lists/listPickerCopy'
import { AttributeEditorBody } from './attributeEditors'
import {
  ABOUT_GROUP,
  ADD_VALUE,
  ADDED_ON,
  DETAILS_GROUP,
  ATTRIBUTES_LABEL,
  LEARNED_GROUP,
  LISTS_GROUP,
} from './attributeCopy'
import { cardRows, attributeRows } from './attributeRows'
import { valuesFromRows } from './tuneFormValues'
import { useAttributeWrite } from './useAttributeWrite'
import type { TuneView } from './useTune'
import type { TuneListMembership } from './useTuneScreen'

const GROUPS = [
  { id: 'details', heading: DETAILS_GROUP },
  { id: 'about', heading: ABOUT_GROUP },
  { id: 'learned', heading: LEARNED_GROUP, cardSection: true },
]

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

export function TuneAttributes({
  view,
  instruments,
  inLists,
  createdAt,
  layout,
  onAddToList,
}: TuneAttributesProps) {
  const write = useAttributeWrite(view.tune.id)
  const rows = attributeRows(view, instruments)

  return (
    <AttributesColumn
      label={ATTRIBUTES_LABEL}
      layout={layout}
      groups={GROUPS}
      rows={rows}
      emptyText={ADD_VALUE}
      stored={valuesFromRows(view.tune, view.userTune)}
      onCommit={write.write}
      editorFor={(row) => <AttributeEditorBody id={row.id} view={view} write={write} />}
      fold={cardRows}
      error={write.error}
      footer={
        <>
          <h2 className={`${COLUMN_HEADER} pt-6`}>{LISTS_GROUP}</h2>
          <div className="px-4 pt-1">
            <TuneLists inLists={inLists} onAddToList={onAddToList} />
          </div>
          <AddedLine createdAt={createdAt} className="px-4 pt-6" />
        </>
      }
    />
  )
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

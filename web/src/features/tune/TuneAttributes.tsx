import { Plus } from 'lucide-react'
import type { Instrument } from '../../api/vocabulary'
import { AttributesColumn, COLUMN_HEADER } from '../../ui/attributes/AttributesColumn'
import { DateAddedLine } from '../../ui/attributes/DateAddedLine'
import { Capsule } from '../../ui/Capsule'
import { ADD_TO_LIST } from '../lists/listPickerCopy'
import { AttributeEditorBody } from './attributeEditors'
import {
  ABOUT_GROUP,
  ADD_VALUE,
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
          <DateAddedLine at={createdAt} className="px-4 pt-6" />
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
          <Capsule label={list.name} to={`/lists/${list.id}`} />
        </li>
      ))}
      <li>
        <Capsule label={ADD_TO_LIST} onPress={onAddToList}>
          <Plus className="size-4" aria-hidden />
          {ADD_TO_LIST}
        </Capsule>
      </li>
    </ul>
  )
}

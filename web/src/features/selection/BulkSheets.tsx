import type { Instrument } from '../../api/vocabulary'
import type { CatalogEntry } from '../../db/types'
import { addTunesToListTitle } from '../lists/listPickerCopy'
import { BulkEditSheet } from './BulkEditSheet'
import { ListPickerSheet } from './ListPickerSheet'
import type { BulkActionsState, SelectionContext } from './useBulkActionsWith'

/**
 * The sheets a selection's actions open, mounted whether or not the screen is selecting so
 * each closes in its own time after the action that ends the mode.
 */
export function BulkSheets({
  actions,
  entries,
  context,
  instruments,
}: {
  actions: BulkActionsState
  /** The selected tunes, in screen order. */
  entries: readonly CatalogEntry[]
  context: SelectionContext
  instruments: ReadonlySet<Instrument>
}) {
  return (
    <>
      <BulkEditSheet
        isOpen={actions.sheet === 'edit'}
        entries={entries}
        instruments={instruments}
        error={actions.edit.error}
        pending={actions.edit.pending}
        onCancel={() => actions.closeSheet('edit')}
        onApply={actions.edit.apply}
      />
      <ListPickerSheet
        isOpen={actions.sheet === 'list'}
        onOpenChange={(open) => {
          if (!open) actions.closeSheet('list')
        }}
        userTuneIds={actions.ids}
        excludeListId={context.kind === 'list' ? context.listId : undefined}
        title={addTunesToListTitle(actions.ids.length)}
        onAdded={actions.listAdded}
      />
    </>
  )
}

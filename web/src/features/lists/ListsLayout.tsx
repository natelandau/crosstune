import { ListMusic } from 'lucide-react'
import { useOutlet, useParams } from 'react-router'
import { useLists } from './useLists'
import { destination } from '../../app/destinations'
import { useStampedDensity } from '../../platform/density'
import { Columns } from '../../app/Columns'
import { CHOOSE_OR_PRESS_N, CHOOSE_OR_TAP_PLUS, DetailEmpty } from '../../app/DetailEmpty'
import { TUNE } from '../tune/tunePageCopy'
import { EmptyState } from '../../ui/EmptyState'
import { ListPage } from './ListPage'
import { ListsScreen } from './ListsScreen'

const LISTS = destination('lists')

export const NO_LIST_SELECTED = 'No list selected'
export const CHOOSE_A_LIST = 'Choose a list to see its tunes'

/**
 * The lists' columns. The content column shows every list, or one list once chosen, and only
 * a tune opened from that list fills the detail, since the detail column shows only a page.
 */
export function ListsLayout() {
  const { listId, tuneId } = useParams()
  const outlet = useOutlet()
  const density = useStampedDensity()
  const name = useLists()?.find((list) => list.id === listId)?.name
  return (
    <Columns
      list={listId ? <ListPage key={listId} listId={listId} /> : <ListsScreen />}
      listLabel={(listId && name) || LISTS.label}
      detail={tuneId ? outlet : null}
      detailLabel={TUNE}
      empty={
        listId ? (
          <DetailEmpty hint={density === 'pointer' ? CHOOSE_OR_PRESS_N : CHOOSE_OR_TAP_PLUS} />
        ) : (
          <EmptyState icon={ListMusic} title={NO_LIST_SELECTED} hint={CHOOSE_A_LIST} />
        )
      }
    />
  )
}

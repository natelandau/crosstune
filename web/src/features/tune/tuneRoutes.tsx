import { useParams } from 'react-router'
import { SETTINGS_STATS_PATH } from '../settings/settingsPaths'
import { useLists } from '../lists/useLists'
import { STATS_TITLE } from '../stats/copy'
import { destination } from '../../app/destinations'
import { TunePage } from './TunePage'

/** A tune opened from the catalog, in the catalog's detail column. */
export function CatalogTune() {
  const { tuneId = '' } = useParams()
  const catalog = destination('catalog')
  return <TunePage tuneId={tuneId} parent={catalog.root} parentLabel={catalog.label} />
}

/** A tune opened from a list, in the lists' detail column; Back names the list. */
export function ListTune() {
  const { listId = '', tuneId = '' } = useParams()
  const list = useLists()?.find((candidate) => candidate.id === listId)
  return (
    <TunePage
      tuneId={tuneId}
      parent={`${destination('lists').root}/${listId}`}
      parentLabel={list?.name ?? destination('lists').label}
    />
  )
}

/** A tune opened from Recordings, in the recordings' detail column. */
export function RecordingsTune() {
  const { tuneId = '' } = useParams()
  const recordings = destination('recordings')
  return <TunePage tuneId={tuneId} parent={recordings.root} parentLabel={recordings.label} />
}

/** A tune opened from stats, in the settings' detail column; Back returns to the stats. */
export function StatsTune() {
  const { tuneId = '' } = useParams()
  return <TunePage tuneId={tuneId} parent={SETTINGS_STATS_PATH} parentLabel={STATS_TITLE} />
}

import { matchPath, useLocation, useParams } from 'react-router'
import { destination } from '../../layout/destinations'
import { listTunePath, tuneHomePath } from '../../layout/tuneHome'
import { statsTunePath } from '../settings/settingsPaths'
import { TUNE } from '../tune/tunePageCopy'
import { useLiveTune } from '../tune/useLiveTune'
import { RecordingPage } from './RecordingPage'
import { entryOf } from './recordingPageState'

/**
 * The page keyed on its recording and its open, so opening it again, such as from its row in
 * the list beside it, starts it afresh on the tab that open asked for. Nothing under it ever
 * sees its recording change, so none of it guards against that.
 */
function Page({ parent, parentLabel }: { parent: string; parentLabel: string }) {
  const { recordingId = '' } = useParams()
  const opening = entryOf(useLocation().state).id ?? ''
  return (
    <RecordingPage
      key={`${recordingId}:${opening}`}
      recordingId={recordingId}
      parent={parent}
      parentLabel={parentLabel}
    />
  )
}

/** The tune's title for Back, or the word for a tune until it reads. */
function useTuneLabel(tuneId: string): string {
  return useLiveTune(tuneId)?.title || TUNE
}

/**
 * A recording opened from Recordings, in the recordings' detail column. One opened from a tune
 * shown there goes back to that tune, as the tab's other pages do.
 */
export function RecordingsRecording() {
  const recordings = destination('recordings')
  const from = entryOf(useLocation().state).from
  const tuneId = from ? matchPath(`${recordings.root}/:tuneId`, from)?.params.tuneId : undefined
  const tuneLabel = useTuneLabel(tuneId ?? '')
  return tuneId && from ? (
    <Page parent={from} parentLabel={tuneLabel} />
  ) : (
    <Page parent={recordings.root} parentLabel={recordings.label} />
  )
}

/** A recording opened from a catalog tune, in the catalog's detail column; Back names the tune. */
export function CatalogRecording() {
  const { tuneId = '' } = useParams()
  return <Page parent={tuneHomePath(tuneId)} parentLabel={useTuneLabel(tuneId)} />
}

/** A recording opened from a tune in a list, in the lists' detail column. */
export function ListRecording() {
  const { listId = '', tuneId = '' } = useParams()
  return <Page parent={listTunePath(listId, tuneId)} parentLabel={useTuneLabel(tuneId)} />
}

/** A recording opened from a tune in the stats, in the settings' detail column. */
export function StatsRecording() {
  const { tuneId = '' } = useParams()
  return <Page parent={statsTunePath(tuneId)} parentLabel={useTuneLabel(tuneId)} />
}

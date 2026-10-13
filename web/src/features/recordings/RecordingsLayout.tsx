import { useOutlet } from 'react-router'
import { destination } from '../../layout/destinations'
import { Columns } from '../../layout/Columns'
import { CHOOSE_FROM_RECORDING, DetailEmpty } from '../../layout/DetailEmpty'
import { TUNE } from '../tune/tunePageCopy'
import { RecordingsScreen } from './RecordingsScreen'

const RECORDINGS = destination('recordings')

/** The recordings' columns, with a tune opened from a group heading or a row as the detail. */
export function RecordingsLayout() {
  const detail = useOutlet()
  return (
    <Columns
      list={<RecordingsScreen />}
      listLabel={RECORDINGS.label}
      detail={detail}
      detailLabel={TUNE}
      empty={<DetailEmpty hint={CHOOSE_FROM_RECORDING} />}
    />
  )
}

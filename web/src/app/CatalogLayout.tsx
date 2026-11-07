import { useOutlet, useParams } from 'react-router'
import { CatalogScreen } from '../features/catalog/CatalogScreen'
import { useStampedDensity } from '../platform/density'
import { Columns } from '../layout/Columns'
import { CHOOSE_OR_PRESS_N, CHOOSE_OR_TAP_PLUS, DetailEmpty } from '../layout/DetailEmpty'
import { AddTuneProvider } from '../features/tune/AddTuneProvider'
import { TUNE } from '../features/tune/tunePageCopy'
import { destination } from '../layout/destinations'
import { RECORDING } from '../text/format'

const CATALOG = destination('catalog')

/** The catalog's columns, with the open tune's page as the detail. */
export function CatalogLayout() {
  const detail = useOutlet()
  const { recordingId } = useParams()
  const density = useStampedDensity()
  return (
    <AddTuneProvider>
      <Columns
        list={<CatalogScreen />}
        listLabel={CATALOG.label}
        detail={detail}
        detailLabel={recordingId ? RECORDING : TUNE}
        empty={
          <DetailEmpty hint={density === 'pointer' ? CHOOSE_OR_PRESS_N : CHOOSE_OR_TAP_PLUS} />
        }
      />
    </AddTuneProvider>
  )
}

import { InstrumentsGroup } from './InstrumentsGroup'
import { MusicServicesGroups } from './MusicServicesGroups'
import { NewTunesGroup } from './NewTunesGroup'

/** Settings > Tunes: the instruments played, what a new tune starts with, and the services searched. */
export function TunesPage() {
  return (
    <>
      <InstrumentsGroup />
      <NewTunesGroup />
      <MusicServicesGroups />
    </>
  )
}

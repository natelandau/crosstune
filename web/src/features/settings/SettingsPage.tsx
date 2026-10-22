import type { ComponentType } from 'react'
import { useParams } from 'react-router'
import type { SettingsPageId } from './settingsPaths'
import { destination } from '../../layout/destinations'
import { ColumnTitle } from '../../layout/ColumnTitle'
import { BackLink, PaneBar } from '../../layout/PaneBar'
import { AccountPage } from './pages/AccountPage'
import { AppearancePage } from './pages/AppearancePage'
import { ImportExportPage } from './pages/ImportExportPage'
import { InstrumentsPage } from './pages/InstrumentsPage'
import { MusicServicesPage } from './pages/MusicServicesPage'
import { NewTunesPage } from './pages/NewTunesPage'
import { SavedLocationDetail } from './pages/SavedLocationDetail'
import { RecordingPage } from './pages/RecordingPage'
import { SavedLocationsPage } from './pages/SavedLocationsPage'
import { SyncPage } from './pages/SyncPage'
import type { SettingsPageSpec } from './settingsPages'

const SETTINGS = destination('settings')

const BODIES: Record<SettingsPageId, ComponentType> = {
  account: AccountPage,
  instruments: InstrumentsPage,
  'new-tunes': NewTunesPage,
  'music-services': MusicServicesPage,
  recording: RecordingPage,
  'saved-locations': SavedLocationsPage,
  appearance: AppearancePage,
  sync: SyncPage,
  'import-export': ImportExportPage,
}

/**
 * One settings page, with Back to Settings where it was pushed. It has no Save: each choice
 * saves as it changes.
 */
export function SettingsPage({ spec }: { spec: SettingsPageSpec }) {
  const Body = BODIES[spec.id]
  const { placeId } = useParams()
  // A saved location has its own bar and title: its name, with Back to the list.
  if (spec.id === 'saved-locations' && placeId) return <SavedLocationDetail placeId={placeId} />
  return (
    <>
      <PaneBar
        title={spec.title}
        leading={<BackLink to={SETTINGS.root} label={SETTINGS.label} />}
      />
      <div className="max-w-page mx-auto w-full">
        <ColumnTitle title={spec.title} syncBadge={false} />
        <div className="px-4 pb-12">
          <Body />
        </div>
      </div>
    </>
  )
}

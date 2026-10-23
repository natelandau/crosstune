import { useRef, type ComponentType } from 'react'
import { useParams } from 'react-router'
import type { SettingsPageId } from './settingsPaths'
import { destination } from '../../layout/destinations'
import { ColumnTitle } from '../../layout/ColumnTitle'
import { BackLink, PaneBar } from '../../layout/PaneBar'
import { AccountPage } from './pages/AccountPage'
import { AppearancePage } from './pages/AppearancePage'
import { ImportExportPage } from './pages/ImportExportPage'
import { RecordingsPage } from './pages/RecordingsPage'
import { SavedLocationDetail } from './pages/SavedLocationDetail'
import { SyncPage } from './pages/SyncPage'
import { TunesPage } from './pages/TunesPage'
import type { SettingsPageSpec } from './settingsPages'
import { useLandOnGroup } from './useLandOnGroup'

const SETTINGS = destination('settings')

const BODIES: Record<SettingsPageId, ComponentType> = {
  account: AccountPage,
  tunes: TunesPage,
  recordings: RecordingsPage,
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
  const bodyRef = useRef<HTMLDivElement>(null)
  useLandOnGroup(bodyRef)
  // A saved location has its own bar and title: its name, with Back to Recordings.
  if (spec.id === 'recordings' && placeId) return <SavedLocationDetail placeId={placeId} />
  return (
    <>
      <PaneBar
        title={spec.title}
        leading={<BackLink to={SETTINGS.root} label={SETTINGS.label} />}
      />
      <div className="max-w-page mx-auto w-full">
        <ColumnTitle title={spec.title} syncBadge={false} />
        <div ref={bodyRef} className="px-4 pb-12">
          <Body />
        </div>
      </div>
    </>
  )
}

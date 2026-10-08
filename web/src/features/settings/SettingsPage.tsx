import type { ComponentType } from 'react'
import type { SettingsPageId } from './settingsPaths'
import { destination } from '../../app/destinations'
import { ColumnTitle } from '../../app/ColumnTitle'
import { BackLink, PaneBar } from '../../app/PaneBar'
import { AccountPage } from './pages/AccountPage'
import { AppearancePage } from './pages/AppearancePage'
import { InstrumentsPage } from './pages/InstrumentsPage'
import { MusicServicesPage } from './pages/MusicServicesPage'
import { RecordingPage } from './pages/RecordingPage'
import { SyncPage } from './pages/SyncPage'
import type { SettingsPageSpec } from './settingsPages'

const SETTINGS = destination('settings')

const BODIES: Record<SettingsPageId, ComponentType> = {
  account: AccountPage,
  instruments: InstrumentsPage,
  'music-services': MusicServicesPage,
  recording: RecordingPage,
  appearance: AppearancePage,
  sync: SyncPage,
}

/**
 * One settings page, with Back to Settings where it was pushed. It has no Save: each choice
 * saves as it changes.
 */
export function SettingsPage({ spec }: { spec: SettingsPageSpec }) {
  const Body = BODIES[spec.id]
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

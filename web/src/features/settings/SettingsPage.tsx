import { IonItem, IonLabel } from '@ionic/react'
import { Group } from '../../ui/Group'
import { Screen } from '../../ui/Screen'
import { APP_VERSION } from '../../version'
import { AccountGroup } from './AccountGroup'
import { AppearanceGroup } from './AppearanceGroup'
import { InstrumentsGroup } from './InstrumentsGroup'
import { RecordingGroup } from './RecordingGroup'
import { SyncGroup } from './SyncGroup'

export function SettingsPage() {
  return (
    <Screen title="Settings" level="top" grouped>
      <h1 className="sr-only">Settings</h1>
      <AccountGroup />
      <InstrumentsGroup />
      <AppearanceGroup />
      <RecordingGroup />
      <SyncGroup />
      <Group header="About">
        <IonItem lines="none">
          <IonLabel>Crosstune {APP_VERSION}</IonLabel>
        </IonItem>
      </Group>
    </Screen>
  )
}

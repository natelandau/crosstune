import { IonItem, IonLabel, IonToggle } from '@ionic/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { useAuthSession } from '../../auth/AuthContext'
import { clearDownloadedBlobs, localAudioBytes } from '../../commands/recordings'
import { setAudioQuality, settingsId } from '../../commands/settings'
import { useAction } from '../../ui/useAction'
import { useDb } from '../../db/DbProvider'
import { getKeepOffline, setKeepOffline } from '../../db/meta'
import { AUDIO_QUALITIES, storedAudioQuality, type AudioQuality } from '../../db/recordings'
import { useSyncEngine } from '../../sync/SyncProvider'
import { ChoiceRow } from '../../ui/ChoiceRow'
import { Group } from '../../ui/Group'
import { usePendingWrite } from '../../ui/usePendingWrite'
import { formatBytes } from '../recording/format'
import { QUALITY_LABELS } from './audioQuality'

/**
 * Capture quality and what audio this device keeps. One control per group, each with its own
 * action, so a refused write reads under the control that produced it.
 */
export function RecordingGroup() {
  const db = useDb()
  const { userId } = useAuthSession()
  const engine = useSyncEngine()
  const qualityAction = useAction()
  const keepAction = useAction()
  const clearAction = useAction()

  const row = useLiveQuery(() => db.user_settings.get(settingsId(userId)), [db, userId])
  // usePendingWrite tells a landed write by identity, so the stored value has to outlive a render.
  const storedQuality = useMemo(() => ({ quality: storedAudioQuality(row) }), [row])
  const [quality, writeQuality] = usePendingWrite<
    { quality: AudioQuality },
    { quality: AudioQuality }
  >(storedQuality, ({ quality }) => setAudioQuality(db, userId, quality))

  const keepOffline = useLiveQuery(() => getKeepOffline(db), [db]) ?? false
  const storedKeep = useMemo(() => ({ on: keepOffline }), [keepOffline])
  const [keep, writeKeep] = usePendingWrite<{ on: boolean }, { on: boolean }>(
    storedKeep,
    async ({ on }) => {
      await setKeepOffline(db, on)
      if (on) {
        void engine.transfer()
        // Asked only once there is something worth protecting from storage eviction.
        void navigator.storage?.persist?.().catch(() => {})
      }
    },
  )
  const on = keep?.on ?? false

  const localBytes = useLiveQuery(() => localAudioBytes(db), [db])

  return (
    <>
      <Group
        header="Recording"
        footer="Higher quality makes larger files."
        error={qualityAction.error}
      >
        <ChoiceRow
          label="Quality"
          value={quality?.quality ?? 'standard'}
          options={AUDIO_QUALITIES}
          labels={QUALITY_LABELS}
          onChange={(next) => qualityAction.run(() => writeQuality({ quality: next }))}
        />
      </Group>
      <Group
        footer="Your recordings are always saved to your account and show up on every device you sign in on. A recording is kept on this device once you play it here. Turn this on to download every recording ahead of time, so all of them play even with no signal."
        error={keepAction.error}
      >
        <IonItem lines="none">
          <IonToggle
            checked={on}
            onIonChange={(event) => {
              const next = event.detail.checked
              keepAction.run(() => writeKeep({ on: next }))
            }}
          >
            Download all recordings to this device
          </IonToggle>
        </IonItem>
      </Group>
      <Group
        footer="Frees up space on this device. Your recordings stay in your account and download again when you play them. Anything not yet saved to your account is kept."
        error={clearAction.error}
      >
        <IonItem lines="full">
          <IonLabel className="tabular-nums">
            {formatBytes(localBytes ?? 0)} of audio on this device
          </IonLabel>
        </IonItem>
        <IonItem
          button
          detail={false}
          disabled={on || clearAction.pending}
          onClick={() => clearAction.run(() => clearDownloadedBlobs(db))}
        >
          <IonLabel>Remove downloaded audio</IonLabel>
        </IonItem>
      </Group>
    </>
  )
}

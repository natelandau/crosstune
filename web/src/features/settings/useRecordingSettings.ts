import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import type { AudioQuality } from '../../api/vocabulary'
import { useAnalytics } from '../../analytics/AnalyticsProvider'
import { useAuthSession } from '../../auth/AuthContext'
import { clearDownloadedBlobs, localAudioBytes } from '../../commands/recordings'
import { setAudioQuality, settingsId } from '../../commands/settings'
import { useDb } from '../../db/DbProvider'
import { getKeepOffline, setKeepOffline } from '../../db/meta'
import { storedAudioQuality } from '../../db/recordings'
import { persistStorage } from '../../platform/storage'
import { useSyncEngine } from '../../sync/SyncProvider'
import { useAction } from '../../ui/useAction'
import { usePendingWrite } from '../../ui/usePendingWrite'
import { audioOnDevice } from './settingsCopy'

export interface RecordingSettings {
  quality: AudioQuality
  setQuality: (next: AudioQuality) => void
  qualityError: string | null
  keepOffline: boolean
  setKeepOffline: (on: boolean) => void
  keepError: string | null
  localBytesLabel: string
  removeDownloads: () => void
  removeError: string | null
  removePending: boolean
}

/**
 * Capture quality and what audio this device keeps. Each control has its own action, so a
 * refused write reads under the control that produced it.
 */
export function useRecordingSettings(): RecordingSettings {
  const db = useDb()
  const { userId } = useAuthSession()
  const engine = useSyncEngine()
  const analytics = useAnalytics()
  const qualityAction = useAction()
  const keepAction = useAction()
  const removeAction = useAction()

  const row = useLiveQuery(() => db.user_settings.get(settingsId(userId)), [db, userId])
  // usePendingWrite tells a landed write by identity, so the stored value has to outlive a render.
  const storedQuality = useMemo(() => ({ quality: storedAudioQuality(row) }), [row])
  const [quality, writeQuality] = usePendingWrite<
    { quality: AudioQuality },
    { quality: AudioQuality }
  >(storedQuality, ({ quality }) => setAudioQuality(db, userId, quality))

  const storedOn = useLiveQuery(() => getKeepOffline(db), [db]) ?? false
  const storedKeep = useMemo(() => ({ on: storedOn }), [storedOn])
  const [keep, writeKeep] = usePendingWrite<{ on: boolean }, { on: boolean }>(
    storedKeep,
    async ({ on }) => {
      await setKeepOffline(db, on)
      if (on) {
        void engine.transfer()
        // Asked only once there is something worth protecting from storage eviction.
        persistStorage()
      }
    },
  )

  const localBytes = useLiveQuery(() => localAudioBytes(db), [db])

  return {
    quality: quality?.quality ?? 'standard',
    setQuality: (next) => {
      const changed = next !== (quality?.quality ?? 'standard')
      qualityAction.run(() =>
        writeQuality({ quality: next }).then(() => {
          if (changed) analytics.send('setting_changed', { setting: 'audio_quality', value: next })
        }),
      )
    },
    qualityError: qualityAction.error,
    keepOffline: keep?.on ?? false,
    setKeepOffline: (on) => {
      const changed = on !== (keep?.on ?? false)
      keepAction.run(() =>
        writeKeep({ on }).then(() => {
          if (changed) analytics.send('setting_changed', { setting: 'download_all', value: on })
        }),
      )
    },
    keepError: keepAction.error,
    localBytesLabel: audioOnDevice(localBytes ?? 0),
    removeDownloads: () => removeAction.run(() => clearDownloadedBlobs(db)),
    removeError: removeAction.error,
    removePending: removeAction.pending,
  }
}

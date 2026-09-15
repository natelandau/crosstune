import { useAuth, useUser } from '@clerk/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuthSession } from '../../auth/AuthContext'
import { clearUnpinnedBlobs, localAudioBytes } from '../../commands/recordings'
import { settingsId, setAudioQuality, toggleInstrumentSetting } from '../../commands/settings'
import { useAction } from '../../components/useAction'
import { useDb } from '../../db/DbProvider'
import { AUDIO_QUALITIES, storedAudioQuality } from '../../db/recordings'
import { getInvalidChangeCount } from '../../db/meta'
import { INSTRUMENTS } from '../../db/types'
import { useSyncEngine, useSyncStatus } from '../../sync/SyncProvider'
import { APP_VERSION } from '../../version'
import { formatBytes } from '../recording/format'
import { QUALITY_LABELS } from './audioQuality'
import { INSTRUMENT_LABELS } from './instruments'
import { signOutAndForget } from './signOut'
import { useInstruments } from './useInstruments'

export function SettingsScreen() {
  const db = useDb()
  const { userId, offline } = useAuthSession()
  const { user } = useUser()
  const { signOut } = useAuth()
  const engine = useSyncEngine()
  const status = useSyncStatus()
  const rejected = useLiveQuery(() => getInvalidChangeCount(db), [db]) ?? 0
  const { error, pending, run } = useAction()
  const instruments = useInstruments()
  const instrumentAction = useAction()
  const audioQuality = storedAudioQuality(
    useLiveQuery(() => db.user_settings.get(settingsId(userId)), [db, userId]),
  )
  const localBytes = useLiveQuery(() => localAudioBytes(db), [db])
  const qualityAction = useAction()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase opacity-60">Account</h2>
        <p>
          {user?.primaryEmailAddress?.emailAddress ?? (offline ? 'Signed in (offline)' : userId)}
        </p>
        <button
          type="button"
          className="btn btn-outline btn-error"
          onClick={() =>
            run(() => signOutAndForget({ db, userId, engine, signOut: () => signOut() }))
          }
          disabled={pending || offline}
        >
          Sign out
        </button>
        {offline ? <p className="text-sm opacity-70">Sign out needs a connection.</p> : null}
        {error ? (
          <p role="alert" className="text-error text-sm">
            {error}
          </p>
        ) : null}
      </section>
      {instruments ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase opacity-60">Instruments</h2>
          <p className="text-sm opacity-70">
            Tuning fields appear only for the instruments you play.
          </p>
          <fieldset className="fieldset">
            <legend className="sr-only">Instruments</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {INSTRUMENTS.map((instrument) => (
                <label key={instrument} className="label min-h-11 cursor-pointer gap-2">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={instruments.has(instrument)}
                    onChange={(e) =>
                      instrumentAction.run(() =>
                        toggleInstrumentSetting(db, userId, instrument, e.target.checked),
                      )
                    }
                  />
                  {INSTRUMENT_LABELS[instrument]}
                </label>
              ))}
            </div>
          </fieldset>
          {instrumentAction.error ? (
            <p role="alert" className="text-error text-sm">
              {instrumentAction.error}
            </p>
          ) : null}
        </section>
      ) : null}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase opacity-60">Recording</h2>
        <p className="text-sm opacity-70">
          Higher quality makes larger files. Standard is fine for a jam.
        </p>
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Recording quality</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {AUDIO_QUALITIES.map((quality) => (
              <label key={quality} className="label min-h-11 cursor-pointer gap-2">
                <input
                  type="radio"
                  name="audio_quality"
                  className="radio"
                  aria-label={QUALITY_LABELS[quality]}
                  checked={audioQuality === quality}
                  onChange={() => qualityAction.run(() => setAudioQuality(db, userId, quality))}
                />
                {QUALITY_LABELS[quality]}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="text-sm">{formatBytes(localBytes ?? 0)} of audio on this device</p>
        <button
          type="button"
          className="btn min-h-11"
          onClick={() => qualityAction.run(() => clearUnpinnedBlobs(db))}
        >
          Remove downloaded audio
        </button>
        <p className="text-sm opacity-70">
          Keeps recordings marked keep offline, any still waiting to upload, and any not yet ready
          on the server.
        </p>
        {qualityAction.error ? (
          <p role="alert" className="text-error text-sm">
            {qualityAction.error}
          </p>
        ) : null}
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase opacity-60">Sync</h2>
        <p>Status: {status}</p>
        {rejected > 0 ? (
          <p role="status" className="text-warning text-sm">
            {rejected === 1
              ? '1 change was rejected by the server and is only on this device.'
              : `${rejected} changes were rejected by the server and are only on this device.`}
          </p>
        ) : null}
        <button type="button" className="btn" onClick={() => void engine.sync()}>
          Sync now
        </button>
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase opacity-60">About</h2>
        <p className="text-sm opacity-70">Crosstune {APP_VERSION}</p>
      </section>
    </div>
  )
}

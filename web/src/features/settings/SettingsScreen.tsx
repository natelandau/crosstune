import { useAuth, useUser } from '@clerk/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuthSession } from '../../auth/AuthContext'
import { clearDownloadedBlobs, localAudioBytes } from '../../commands/recordings'
import { settingsId, setAudioQuality, toggleInstrumentSetting } from '../../commands/settings'
import { Field, HelpText, Page, PageHeading, Section } from '../../components/Page'
import { useAction } from '../../components/useAction'
import { useDb } from '../../db/DbProvider'
import { AUDIO_QUALITIES, storedAudioQuality } from '../../db/recordings'
import { getInvalidChangeCount, getKeepOffline, setKeepOffline } from '../../db/meta'
import { INSTRUMENTS } from '../../db/types'
import { useSyncEngine, useSyncStatus } from '../../sync/SyncProvider'
import { APP_VERSION } from '../../version'
import { formatBytes } from '../recording/format'
import {
  APPEARANCE_LABELS,
  APPEARANCES,
  setAppearance,
  setTextSize,
  TEXT_SIZE_LABELS,
  TEXT_SIZES,
  useAppearance,
  useTextSize,
} from './appearance'
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
  const keepOffline = useLiveQuery(() => getKeepOffline(db), [db]) ?? false
  const qualityAction = useAction()
  const appearance = useAppearance()
  const textSize = useTextSize()

  return (
    <Page>
      <PageHeading>Settings</PageHeading>
      <Section title="Account">
        <p>
          {user?.primaryEmailAddress?.emailAddress ?? (offline ? 'Signed in (offline)' : userId)}
        </p>
        <Field>
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
          {offline ? <HelpText>Sign out needs a connection.</HelpText> : null}
          {error ? (
            <p role="alert" className="text-error text-meta">
              {error}
            </p>
          ) : null}
        </Field>
      </Section>
      {instruments ? (
        <Section title="Instruments">
          <Field>
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
            <HelpText>Tuning fields appear only for the instruments you play.</HelpText>
            {instrumentAction.error ? (
              <p role="alert" className="text-error text-meta">
                {instrumentAction.error}
              </p>
            ) : null}
          </Field>
        </Section>
      ) : null}
      <Section title="Appearance">
        <Field>
          <fieldset className="fieldset">
            <legend className="fieldset-legend">Theme</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {APPEARANCES.map((option) => (
                <label key={option} className="label min-h-11 cursor-pointer gap-2">
                  <input
                    type="radio"
                    name="appearance"
                    className="radio"
                    aria-label={APPEARANCE_LABELS[option]}
                    checked={appearance === option}
                    onChange={() => setAppearance(option)}
                  />
                  {APPEARANCE_LABELS[option]}
                </label>
              ))}
            </div>
          </fieldset>
          <HelpText>System follows the phone when it switches.</HelpText>
        </Field>
        <fieldset className="fieldset">
          <legend className="fieldset-legend">Text size</legend>
          <input
            type="range"
            // Three positions, not a quantity: no fill from the left.
            className="range w-full [--range-fill:0]"
            aria-label="Text size"
            aria-valuetext={TEXT_SIZE_LABELS[textSize]}
            min={0}
            max={TEXT_SIZES.length - 1}
            step={1}
            value={TEXT_SIZES.indexOf(textSize)}
            onChange={(e) => setTextSize(TEXT_SIZES[Number(e.target.value)] ?? 'regular')}
          />
          <div className="text-small flex justify-between px-1" aria-hidden="true">
            {TEXT_SIZES.map((size) => (
              <span key={size} className={size === textSize ? '' : 'opacity-60'}>
                {TEXT_SIZE_LABELS[size]}
              </span>
            ))}
          </div>
        </fieldset>
      </Section>
      <Section title="Recording">
        <Field>
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
          <HelpText>Higher quality makes larger files. Standard is fine for a jam.</HelpText>
        </Field>
        <Field>
          <label className="label min-h-11 cursor-pointer gap-2">
            <input
              type="checkbox"
              className="toggle"
              checked={keepOffline}
              onChange={(e) => {
                const on = e.target.checked
                qualityAction.run(async () => {
                  await setKeepOffline(db, on)
                  if (on) {
                    void engine.transfer()
                    // Asked only once there is something worth protecting from storage eviction.
                    void navigator.storage?.persist?.().catch(() => {})
                  }
                })
              }}
            />
            Download all recordings to this device
          </label>
          <HelpText>
            Your recordings are always saved to your account and show up on every device you sign in
            on. A recording is kept on this device once you play it here. Turn this on to download
            every recording ahead of time, so all of them play even with no signal.
          </HelpText>
        </Field>
        <Field>
          <p>{formatBytes(localBytes ?? 0)} of audio on this device</p>
          <button
            type="button"
            className="btn min-h-11"
            disabled={keepOffline}
            onClick={() => qualityAction.run(() => clearDownloadedBlobs(db))}
          >
            Remove downloaded audio
          </button>
          <HelpText>
            Frees up space on this device. Your recordings stay in your account and download again
            when you play them. Anything not yet saved to your account is kept.
          </HelpText>
          {qualityAction.error ? (
            <p role="alert" className="text-error text-meta">
              {qualityAction.error}
            </p>
          ) : null}
        </Field>
      </Section>
      <Section title="Sync">
        <Field>
          <p>Status: {status}</p>
          {rejected > 0 ? (
            <p role="status" className="text-warning text-meta">
              {rejected === 1
                ? '1 change was rejected by the server and is only on this device.'
                : `${rejected} changes were rejected by the server and are only on this device.`}
            </p>
          ) : null}
        </Field>
        <button type="button" className="btn" onClick={() => void engine.sync()}>
          Sync now
        </button>
      </Section>
      <Section title="About">
        <HelpText>Crosstune {APP_VERSION}</HelpText>
      </Section>
    </Page>
  )
}

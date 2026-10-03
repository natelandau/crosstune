import { IonButton, IonCheckbox, IonItem, IonLabel } from '@ionic/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { useAuthSession } from '../../auth/AuthContext'
import { settingsId, setPlayFirst, toggleSearchProvider } from '../../commands/settings'
import { PROVIDER_LABELS } from '../../constants'
import { useDb } from '../../db/DbProvider'
import { storedPlayFirst } from '../../db/types'
import { ChoiceRow } from '../../ui/ChoiceRow'
import { Group } from '../../ui/Group'
import { Sheet } from '../../ui/Sheet'
import { useAction } from '../../ui/useAction'
import { usePendingWrite } from '../../ui/usePendingWrite'
import type { PlayFirst } from '../../api/vocabulary'
import { PLAY_FIRST, PLAY_FIRST_HELP, PLAY_FIRST_LABEL, PLAY_FIRST_LABELS } from './playFirst'
import {
  MUSIC_SERVICES,
  MUSIC_SERVICES_HELP,
  servicesSummary,
  SEARCHABLE_PROVIDERS,
  useSearchProviders,
} from './searchProviders'

/**
 * The streaming services a tune's recording search covers, chosen in a sheet like the
 * instruments. Each tap writes its own toggle, so two taps in a row both land.
 */
export function MusicServicesGroup() {
  const db = useDb()
  const { userId } = useAuthSession()
  const chosenSet = useSearchProviders()
  const { clear, error, run } = useAction()
  const [open, setOpen] = useState(false)
  // The sheet's rows stay mounted through its dismiss animation, so a refusal can only move to
  // the row once they are gone; `open` alone would put one refusal in two alert regions.
  const [showing, setShowing] = useState(false)
  const playFirstAction = useAction()
  const settings = useLiveQuery(() => db.user_settings.get(settingsId(userId)), [db, userId])
  // usePendingWrite tells a landed write by identity, so the stored value has to outlive a render.
  const storedFirst = useMemo(() => ({ first: storedPlayFirst(settings) }), [settings])
  const [playFirst, writePlayFirst] = usePendingWrite<{ first: PlayFirst }, { first: PlayFirst }>(
    storedFirst,
    ({ first }) => setPlayFirst(db, userId, first),
  )

  if (!chosenSet) return null

  const summary = servicesSummary(
    SEARCHABLE_PROVIDERS.filter((provider) => chosenSet.has(provider)).length,
  )

  return (
    <>
      <Group
        header={MUSIC_SERVICES}
        footer={`${MUSIC_SERVICES_HELP} ${PLAY_FIRST_HELP}`}
        // While the sheet is up it holds the checkboxes, so a refusal reports there instead.
        error={showing ? null : (error ?? playFirstAction.error)}
      >
        <IonItem
          button
          detail
          onClick={() => {
            clear()
            setShowing(true)
            setOpen(true)
          }}
        >
          {/* The header names the row visually; an ion-item forwards an aria-label only as a
              snapshot, so the name is content a screen reader reads as it changes. */}
          <IonLabel className="truncate">
            <span className="sr-only">{MUSIC_SERVICES}</span>
            {summary}
          </IonLabel>
        </IonItem>
        <ChoiceRow
          label={PLAY_FIRST_LABEL}
          value={playFirst?.first ?? 'recordings'}
          options={PLAY_FIRST}
          labels={PLAY_FIRST_LABELS}
          onChange={(next) => playFirstAction.run(() => writePlayFirst({ first: next }))}
        />
      </Group>
      <Sheet
        open={open}
        title={MUSIC_SERVICES}
        onClose={() => {
          setOpen(false)
          setShowing(false)
        }}
        end={
          <IonButton strong onClick={() => setOpen(false)}>
            Done
          </IonButton>
        }
      >
        <Group error={error}>
          {SEARCHABLE_PROVIDERS.map((provider) => (
            <IonItem key={provider}>
              <IonCheckbox
                checked={chosenSet.has(provider)}
                onIonChange={(event) =>
                  run(() => toggleSearchProvider(db, userId, provider, event.detail.checked))
                }
              >
                {PROVIDER_LABELS[provider]}
              </IonCheckbox>
            </IonItem>
          ))}
        </Group>
      </Sheet>
    </>
  )
}

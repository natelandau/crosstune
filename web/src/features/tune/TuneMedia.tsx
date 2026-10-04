import { IonButton } from '@ionic/react'
import { AudioLines, CircleDot, Download, Link, Plus, Search, Trash2 } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { removeLink } from '../../commands/links'
import { addRecordingFromLink } from '../../commands/recordings'
import { setPlaySource } from '../../commands/tunes'
import { PROVIDER_LABELS } from '../../constants'
import { useDb } from '../../db/DbProvider'
import type { Provider } from '../../api/vocabulary'
import type { LocalRecordingLink } from '../../db/types'
import { EmptyState } from '../../ui/EmptyState'
import { Group } from '../../ui/Group'
import { useMenu, type MenuItem } from '../../ui/Menu'
import { useOnline, useSyncEngine } from '../../sync/SyncProvider'
import { FindRecordingsSheet } from '../links/FindRecordingsSheet'
import {
  ADD_TO_RECORDINGS,
  FIND_RECORDINGS,
  SEARCH_NEEDS_CONNECTION,
  searchService,
} from '../links/findRecordingsCopy'
import {
  IMPORTABLE_PROVIDERS,
  openServiceSearch,
  prefillFor,
  searchesInApp,
  searchQuery,
} from '../links/serviceSearch'
import { LinkItem } from '../links/LinkItem'
import { PASTE_LINK, PasteLinkSheet } from '../links/PasteLinkSheet'
import { NEW_RECORDING } from '../recording/RecordModal'
import { useRecord } from '../recording/useRecord'
import { retryKind } from '../recordings/recordingRow'
import { RecordingItem } from '../recordings/RecordingItem'
import { RenameRecordingSheet } from '../recordings/RenameRecordingSheet'
import { useRecordingActions } from '../recordings/useRecordingActions'
import type { RecordingView } from '../recordings/useRecordings'
import { useSearchProviders } from '../settings/searchProviders'
import { pinRowAction } from './playSourceText'

export const ADD_RECORDING = 'Add recording'
export const NO_MEDIA_TITLE = 'Nothing recorded yet'
export const NO_MEDIA_HINT = 'Record one, find one, or paste a link to one.'

/**
 * How a tune sounds: the recordings made of it, the links to it elsewhere, and the ways to
 * add one. Groups only, never a page of its own, so the tune screen keeps its single Screen.
 */
export function TuneMedia({
  tuneId,
  recordings,
  links,
}: {
  tuneId: string
  /** This tune's recordings in position order, read by the screen that mounts this. */
  recordings: readonly RecordingView[]
  links: readonly LocalRecordingLink[]
}) {
  const db = useDb()
  const { start } = useRecord()
  const openMenu = useMenu()
  const online = useOnline()
  const engine = useSyncEngine()
  const providers = useSearchProviders()
  const [pasting, setPasting] = useState(false)
  const [renaming, setRenaming] = useState<RecordingView | null>(null)
  const [finding, setFinding] = useState(false)
  // No Add to tune: every recording here is already filed under the tune being looked at.
  // The pin is read here rather than passed down, so the rows that show it are the ones that
  // change it. A pin naming a row of another tune never matches one of this tune's rows.
  const userTune = useLiveQuery(
    async () =>
      (await db.user_tunes.where('tune_id').equals(tuneId).toArray()).find((u) => !u.deleted_at),
    [db, tuneId],
  )
  const pinnedRecordingId = userTune?.play_recording_id ?? null
  const pinnedLinkId = userTune?.play_link_id ?? null
  const { error, run, retry, actionsFor } = useRecordingActions({
    onRename: setRenaming,
    pin: userTune ? { userTuneId: userTune.id, recordingId: pinnedRecordingId } : undefined,
  })

  // One chosen service skips the list of services: the item names it and goes straight there.
  const only = providers?.size === 1 ? [...providers][0]! : null
  // Read ahead of the tap, since the tab has to open before anything is awaited.
  const prefill = useLiveQuery(async () => prefillFor(await db.tunes.get(tuneId)), [db, tuneId])
  const searchElsewhere = (provider: Provider) =>
    run(async () => {
      const message = await openServiceSearch(
        engine,
        searchQuery(prefill ?? ''),
        provider,
        PROVIDER_LABELS[provider],
      )
      if (message) throw new Error(message)
    })
  const find: MenuItem =
    only && !searchesInApp(only)
      ? {
          label: searchService(PROVIDER_LABELS[only]),
          icon: Search,
          opensTab: true,
          onPress: () => searchElsewhere(only),
        }
      : {
          label: only ? searchService(PROVIDER_LABELS[only]) : FIND_RECORDINGS,
          icon: Search,
          onPress: () => setFinding(true),
        }

  // A live recording that already came from this link's page is the link's audio saved.
  const canImport = (link: LocalRecordingLink) =>
    IMPORTABLE_PROVIDERS.some((provider) => provider === link.provider) &&
    !!link.provider_ref &&
    !recordings.some((view) => view.recording.origin_url === link.url)

  const empty = recordings.length === 0 && links.length === 0
  // On the header rather than below the card, so an empty tune still reaches it and adding stops
  // outweighing the rows it adds to. A plus is what every other screen's add control wears, and
  // the menu behind it is where the ways are named: a glyph reads as nothing aloud, and a
  // tune synced from another device never shows the empty state that would have named them.
  const add = (
    <IonButton
      fill="clear"
      className="section-action"
      aria-label={ADD_RECORDING}
      onClick={(event) =>
        openMenu(event, ADD_RECORDING, [
          { label: NEW_RECORDING, icon: CircleDot, onPress: () => start(tuneId) },
          { label: PASTE_LINK, icon: Link, onPress: () => setPasting(true) },
          { ...find, refused: online ? undefined : SEARCH_NEEDS_CONNECTION },
        ])
      }
    >
      <Plus aria-hidden="true" className="size-6" />
    </IonButton>
  )

  return (
    <>
      {/* One list, because a recording and a link are one row shape doing one job for the
          musician: hear this tune. Recordings lead, since they are the musician's own. A
          refused row action shows under the rows it refused, where a group puts its own. */}
      <Group header="Recordings" name="Recordings" actions={add} plain={empty} error={error}>
        {empty ? (
          <EmptyState compact icon={AudioLines} title={NO_MEDIA_TITLE} hint={NO_MEDIA_HINT} />
        ) : (
          <>
            {recordings.map((view) => (
              <RecordingItem
                key={view.recording.id}
                view={view}
                pinned={view.recording.id === pinnedRecordingId}
                actions={actionsFor(view)}
                error={retryKind(view) === 'upload' ? view.file?.error : null}
                // The screen's own heading above this already names the tune.
                tuneNamedAbove
                onRetry={(kind) => retry(view, kind)}
              />
            ))}
            {links.map((link) => {
              const pinned = link.id === pinnedLinkId
              return (
                <LinkItem
                  key={link.id}
                  link={link}
                  pinned={pinned}
                  actions={[
                    ...(userTune
                      ? [
                          pinRowAction(pinned, () =>
                            run(() =>
                              setPlaySource(
                                db,
                                userTune.id,
                                pinned ? null : { kind: 'link', id: link.id },
                              ),
                            ),
                          ),
                        ]
                      : []),
                    ...(canImport(link)
                      ? [
                          {
                            label: ADD_TO_RECORDINGS,
                            short: 'Add',
                            icon: Download,
                            tone: 'neutral' as const,
                            onPress: () => run(() => addRecordingFromLink(db, link.id)),
                          },
                        ]
                      : []),
                    {
                      label: 'Remove',
                      icon: Trash2,
                      tone: 'error',
                      onPress: () => run(() => removeLink(db, link.id)),
                    },
                  ]}
                />
              )
            })}
          </>
        )}
      </Group>
      <PasteLinkSheet tuneId={pasting ? tuneId : null} onClose={() => setPasting(false)} />
      <RenameRecordingSheet view={renaming} onClose={() => setRenaming(null)} />
      <FindRecordingsSheet
        tuneId={finding ? tuneId : null}
        service={only ?? undefined}
        onClose={() => setFinding(false)}
      />
    </>
  )
}

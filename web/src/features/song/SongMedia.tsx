import { IonButton } from '@ionic/react'
import { AudioLines, Link, Mic, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { removeLink } from '../../commands/links'
import { useDb } from '../../db/DbProvider'
import type { LocalRecordingLink } from '../../db/types'
import { EmptyState } from '../../ui/EmptyState'
import { Group } from '../../ui/Group'
import { useMenu } from '../../ui/Menu'
import { LinkItem } from '../links/LinkItem'
import { PASTE_LINK, PasteLinkSheet } from '../links/PasteLinkSheet'
import { NEW_RECORDING } from '../recording/RecordModal'
import { useRecord } from '../recording/useRecord'
import { retryKind } from '../recordings/recordingRow'
import { RecordingItem } from '../recordings/RecordingItem'
import { RenameRecordingSheet } from '../recordings/RenameRecordingSheet'
import { useRecordingActions } from '../recordings/useRecordingActions'
import type { RecordingView } from '../recordings/useRecordings'

export const ADD_RECORDING = 'Add recording'
export const NO_MEDIA_TITLE = 'Nothing recorded yet'
export const NO_MEDIA_HINT = 'Record one, or paste a link to one.'

/**
 * How a song sounds: the recordings made of it, the links to it elsewhere, and the two ways to
 * add one. Groups only, never a page of its own, so the song screen keeps its single Screen.
 */
export function SongMedia({
  songId,
  recordings,
  links,
}: {
  songId: string
  /** This song's recordings in position order, read by the screen that mounts this. */
  recordings: readonly RecordingView[]
  links: readonly LocalRecordingLink[]
}) {
  const db = useDb()
  const { start } = useRecord()
  const openMenu = useMenu()
  const [renaming, setRenaming] = useState<RecordingView | null>(null)
  const [pasting, setPasting] = useState(false)
  // No Add to song: every recording here is already filed under the song being looked at.
  const { error, run, retry, actionsFor } = useRecordingActions({
    onRename: setRenaming,
  })

  const empty = recordings.length === 0 && links.length === 0
  // On the header rather than below the card, so an empty song still reaches it and adding stops
  // outweighing the rows it adds to. A plus is what every other screen's add control wears, and
  // the menu behind it is where the two ways are named: a glyph reads as nothing aloud, and a
  // song synced from another device never shows the empty state that would have named them.
  const add = (
    <IonButton
      fill="clear"
      className="section-action"
      aria-label={ADD_RECORDING}
      onClick={(event) =>
        openMenu(event, ADD_RECORDING, [
          { label: NEW_RECORDING, icon: Mic, onPress: () => start(songId) },
          { label: PASTE_LINK, icon: Link, onPress: () => setPasting(true) },
        ])
      }
    >
      <Plus aria-hidden="true" className="size-6" />
    </IonButton>
  )

  return (
    <>
      {/* One list, because a recording and a link are one row shape doing one job for the
          musician: hear this song. Recordings lead, since they are the musician's own. A
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
                actions={actionsFor(view)}
                error={retryKind(view) === 'upload' ? view.file?.error : null}
                // The screen's own heading above this already names the song.
                songNamedAbove
                onRetry={(kind) => retry(view, kind)}
              />
            ))}
            {links.map((link) => (
              <LinkItem
                key={link.id}
                link={link}
                actions={[
                  {
                    label: 'Remove',
                    icon: Trash2,
                    tone: 'error',
                    onPress: () => run(() => removeLink(db, link.id)),
                  },
                ]}
              />
            ))}
          </>
        )}
      </Group>
      <RenameRecordingSheet view={renaming} onClose={() => setRenaming(null)} />
      <PasteLinkSheet songId={pasting ? songId : null} onClose={() => setPasting(false)} />
    </>
  )
}

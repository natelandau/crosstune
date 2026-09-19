import { IonButton } from '@ionic/react'
import { AudioLines, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { removeLink } from '../../commands/links'
import { useDb } from '../../db/DbProvider'
import type { LocalRecordingLink } from '../../db/types'
import { EmptyState } from '../../ui/EmptyState'
import { Group } from '../../ui/Group'
import { InlineError } from '../../ui/InlineError'
import { LinkItem } from '../links/LinkItem'
import { PasteLinkSheet } from '../links/PasteLinkSheet'
import { useRecord } from '../recording/useRecord'
import { retryKind } from '../recordings/recordingRow'
import { RecordingItem } from '../recordings/RecordingItem'
import { RenameRecordingSheet } from '../recordings/RenameRecordingSheet'
import { UploadButton } from '../recordings/UploadButton'
import { useRecordingActions } from '../recordings/useRecordingActions'
import type { RecordingView } from '../recordings/useRecordings'

/**
 * How a song sounds: the recordings made of it, the links to it elsewhere, and the three ways to
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
  const [renaming, setRenaming] = useState<RecordingView | null>(null)
  const [pasting, setPasting] = useState(false)
  // No Add to song: every recording here is already filed under the song being looked at.
  const { error, setUploadError, run, retry, actionsFor } = useRecordingActions({
    onRename: setRenaming,
  })

  return (
    <>
      {recordings.length === 0 && links.length === 0 ? (
        <EmptyState compact icon={AudioLines} title="Nothing recorded yet" />
      ) : null}
      {recordings.length > 0 ? (
        <Group header="Recordings" name="Recordings">
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
        </Group>
      ) : null}
      {links.length > 0 ? (
        <Group header="Links" name="Links">
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
        </Group>
      ) : null}
      {/* Above the controls, so a refused row action sits beside the rows rather than below
          the three ways to add another one. */}
      {error ? <InlineError className="px-(--form-inset) pt-1.5">{error}</InlineError> : null}
      <div className="flex flex-wrap gap-2 px-(--form-gutter) pt-3">
        <IonButton className="min-h-11" onClick={() => start(songId)}>
          Record
        </IonButton>
        <UploadButton songId={songId} onError={setUploadError} />
        <IonButton className="min-h-11" onClick={() => setPasting(true)}>
          Paste link
        </IonButton>
      </div>
      <RenameRecordingSheet view={renaming} onClose={() => setRenaming(null)} />
      <PasteLinkSheet songId={pasting ? songId : null} onClose={() => setPasting(false)} />
    </>
  )
}

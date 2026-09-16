import { HelpText, Page, PageHeading } from '../../components/Page'
import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useMemo } from 'react'
import { useOpenRow } from '../../components/swipe'
import { SongCard } from '../catalog/SongCard'
import { useCatalog } from '../catalog/useCatalog'
import { UploadRecordingInput } from '../recording/UploadRecordingInput'
import { useInstruments } from '../settings/useInstruments'
import { RecordingList } from './RecordingList'
import { StorageMeter } from './StorageMeter'
import { useRecordingsWithFiles, type RecordingView } from './useRecordings'

interface Group {
  songId: string | null
  title: string
  views: RecordingView[]
}

/** Unfiled recordings first, then one group per song in order of its newest recording. */
function groupBySong(views: RecordingView[]): Group[] {
  const groups = new Map<string | null, Group>()
  for (const view of views) {
    const group = groups.get(view.songId)
    if (group) group.views.push(view)
    else {
      groups.set(view.songId, {
        songId: view.songId,
        title: view.songTitle ?? 'Unfiled',
        views: [view],
      })
    }
  }
  return [...groups.values()]
}

export function RecordingsScreen() {
  const views = useRecordingsWithFiles()
  const entries = useCatalog()
  const instruments = useInstruments()
  const rowState = useOpenRow()
  const groups = useMemo(() => (views ? groupBySong(views) : []), [views])
  const entryFor = useMemo(
    () => new Map((entries ?? []).map((entry) => [entry.song.id, entry])),
    [entries],
  )
  if (views === undefined || entries === undefined || instruments === undefined) return null
  return (
    <Page>
      <PageHeading>Recordings</PageHeading>
      <StorageMeter />
      {groups.length === 0 ? <HelpText>No recordings yet.</HelpText> : null}
      {groups.map((group) => {
        const entry = group.songId ? entryFor.get(group.songId) : undefined
        return (
          <section key={group.songId ?? ''} className="space-y-2">
            {entry ? (
              <Link
                to="/songs/$id"
                params={{ id: entry.song.id }}
                draggable={false}
                className="flex items-center"
              >
                <div className="min-w-0 flex-1">
                  <SongCard entry={entry} instruments={instruments} linked={false} />
                </div>
                <ChevronRight aria-hidden="true" className="mr-3 size-4 shrink-0 opacity-40" />
              </Link>
            ) : (
              <h2 className="text-title flex min-h-11 items-center px-3 opacity-60">
                {group.title}
              </h2>
            )}
            <RecordingList views={group.views} label={group.title} rowState={rowState} />
          </section>
        )
      })}
      <UploadRecordingInput songId={null} />
    </Page>
  )
}

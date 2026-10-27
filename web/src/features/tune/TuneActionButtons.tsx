import { ExternalLink, Gauge, Play, Square, TextQuote } from 'lucide-react'
import type { ReactNode } from 'react'
import { recordingsPlayable } from '../../billing/plan'
import { usePlanCheckOrUnknown, usePlanOrUnknown } from '../../billing/usePlan'
import type { LocalRecordingLink } from '../../db/types'
import { useFrame } from '../../platform/frame'
import { Button } from '../../ui/Button'
import { ActionButtonRow } from '../../ui/ActionButtonRow'
import { OPEN } from '../links/linkNames'
import type { LinkControl } from '../links/linkControl'
import { useLinkRow } from '../links/useLinkRow'
import { TUNE_ROW_ORIGIN } from '../player/playLog'
import { PLAY } from '../player/transportCopy'
import { isPlaying, usePlayer } from '../player/usePlayer'
import { useTuneSource } from '../player/useTuneSource'
import { usePracticeOverlay } from '../practice/usePracticeOverlay'
import type { RecordingView } from '../recordings/useRecordings'
import { LYRICS_SECTION } from './tuneScreenCopy'
import { PRACTICE, STOP } from './tuneActionsCopy'
import type { TuneMediaData } from './useTuneMedia'

/** What the main button does now. */
interface PlayAction {
  control: LinkControl
  onPress: () => void
}

/** The main button, named for what a press does: play, stop, or open a link on its own site. */
function PlayButton({ control, onPress }: PlayAction) {
  const [label, icon] =
    control === 'close' ? [STOP, Square] : control === 'open' ? [OPEN, ExternalLink] : [PLAY, Play]
  return (
    <Button variant="primary" icon={icon} solidIcon label={label} fullWidth onPress={onPress} />
  )
}

type RowProps = Omit<Parameters<typeof ActionButtons>[0], 'play'>

/**
 * A recording not on this device plays too, rather than offering Download: the player fetches
 * it, since a Download at the top of the page reads as downloading the tune. `useTuneSource`
 * offers only a recording that can play now.
 */
function RecordingActionButtons({ view, ...rest }: { view: RecordingView } & RowProps) {
  const player = usePlayer()
  const item = { kind: 'recording' as const, id: view.recording.id }
  const play: PlayAction = isPlaying(player, item)
    ? { control: 'close', onPress: () => player.close() }
    : { control: 'play', onPress: () => player.play(item, TUNE_ROW_ORIGIN) }
  return <ActionButtons {...rest} play={play} />
}

function LinkActionButtons({ link, ...rest }: { link: LocalRecordingLink } & RowProps) {
  const { control, open } = useLinkRow(link)
  return <ActionButtons {...rest} play={open ? { control, onPress: open.onOpen } : null} />
}

/** The row itself: each button shows only while it can act, and with none there is no row. */
function ActionButtons({
  play,
  practiceId,
  onPractice,
  onLyrics,
}: {
  play: PlayAction | null
  practiceId: string | null
  onPractice: (recordingId: string) => void
  /** Opens the lyrics reader, or null when the tune has no lyrics. */
  onLyrics: (() => void) | null
}) {
  const phone = useFrame() === 'phone'
  if (!play && !practiceId && !onLyrics) return null
  const buttons: ReactNode[] = []
  if (play) buttons.push(<PlayButton key="play" {...play} />)
  if (practiceId) {
    buttons.push(
      <Button
        key="practice"
        variant="tinted"
        icon={Gauge}
        label={PRACTICE}
        fullWidth
        onPress={() => onPractice(practiceId)}
      />,
    )
  }
  if (onLyrics) {
    buttons.push(
      <Button
        key="lyrics"
        variant="tinted"
        icon={TextQuote}
        label={LYRICS_SECTION}
        fullWidth
        onPress={onLyrics}
      />,
    )
  }
  return <ActionButtonRow tight={phone}>{buttons}</ActionButtonRow>
}

/**
 * What a musician does with the tune, under its title: play what it plays, practice it, or read
 * its lyrics. A button shows only when it can act, and a tune with none has no row; its Recordings
 * start card is the way on.
 */
export function TuneActionButtons({
  tuneId,
  media,
  onLyrics,
}: {
  tuneId: string
  media: TuneMediaData
  /** Opens the lyrics reader, or null when the tune has no lyrics. */
  onLyrics: (() => void) | null
}) {
  const player = usePlayer()
  const source = useTuneSource(tuneId, player.item?.kind === 'recording' ? player.item.id : null)
  const practice = usePracticeOverlay()
  const recordingsPlay = recordingsPlayable(usePlanOrUnknown())
  // An unread entitlement judges as unknown, which plays; waiting keeps a free plan from
  // flashing a button it then drops.
  const planRead = usePlanCheckOrUnknown().row !== undefined

  // Held at the row's height while the source and plan read, so nothing shifts when they arrive.
  if (source === undefined || !planRead)
    return <div className="min-h-(--target-control)" aria-hidden />

  // Practice takes only a recording held on this device, as Play does.
  const practiceable = (view: RecordingView) => Boolean(view.file?.blob)
  const practiceId = !recordingsPlay
    ? null
    : source?.kind === 'recording' && practiceable(source.view)
      ? source.view.recording.id
      : (media.recordingRows.find((row) => practiceable(row.view))?.view.recording.id ?? null)

  const row = { practiceId, onPractice: practice.open, onLyrics }
  if (source === null) return <ActionButtons {...row} play={null} />
  return source.kind === 'recording' ? (
    <RecordingActionButtons key={source.view.recording.id} view={source.view} {...row} />
  ) : (
    <LinkActionButtons key={source.link.id} link={source.link} {...row} />
  )
}

import { usePlaybackEngine, useEngineState } from '../player/PlaybackEngineProvider'
import { useRecording } from '../capture/RecordState'
import { NowPlayingGlyph, SlotButton, TransportGlyph } from '../../ui/rowGlyphs'

/**
 * The playing list's control, on its row on the Lists screen and on its current tune's row.
 * While the list sounds it shows the now-playing glyph and pauses; while paused it shows play
 * in accent and resumes where the list stopped. Disabled while recording, as the list's Play is.
 */
export function NowPlayingControl({
  pauseName,
  playName,
  settled,
}: {
  pauseName: string
  playName: string
  /** The player holds the playing list's current tune; false while the next one loads. */
  settled: boolean
}) {
  const engine = usePlaybackEngine()
  const playing = useEngineState(engine, (state) => state.playing)
  const recording = useRecording()
  return (
    <SlotButton
      name={playing ? pauseName : playName}
      // Until the next tune loads, the engine holds the one being left.
      isDisabled={!settled || recording}
      onPress={() => (playing ? engine.pause() : engine.play())}
    >
      {playing ? <NowPlayingGlyph /> : <TransportGlyph shape="play" tone="accent" />}
    </SlotButton>
  )
}

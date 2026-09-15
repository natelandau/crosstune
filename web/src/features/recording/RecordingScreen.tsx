import { useNavigate, useSearch } from '@tanstack/react-router'
import { useLiveQuery } from 'dexie-react-hooks'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { useDb } from '../../db/DbProvider'
import { liveSong } from '../../db/songs'
import { unlockAudioContext, wasUnlockedByTap } from './audioContext'
import { formatDuration } from './format'
import { LiveWaveform } from './LiveWaveform'
import { SaveRecordingSheet } from './SaveRecordingSheet'
import { type CapturePhase, useCapture } from './useCapture'

const STATUS: Record<CapturePhase, string> = {
  starting: 'Starting the microphone',
  recording: 'Recording',
  interrupted: 'Interrupted',
  saving: 'Saving',
  saved: 'Saved',
  denied: 'Not recording',
  failed: 'Not recording',
}

/** A reload or a restored tab lands here with no tap behind it, and iOS never lets a
 * take start without one; a fresh Record navigation always arrives already unlocked. */
export function RecordingScreen() {
  const [unlocked, setUnlocked] = useState(wasUnlockedByTap)
  if (!unlocked) {
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center">
        <button
          type="button"
          className="btn btn-error btn-lg min-h-11"
          onClick={() => {
            unlockAudioContext()
            setUnlocked(true)
          }}
        >
          Start recording
        </button>
      </div>
    )
  }
  return <RecordingCapture />
}

function RecordingCapture() {
  const db = useDb()
  const navigate = useNavigate()
  const { song: songId = null } = useSearch({ from: '/record' })
  const song = useLiveQuery(
    async () => (songId ? ((await db.songs.get(songId)) ?? null) : null),
    [db, songId],
  )
  const { phase, recordingId, elapsedMs, analyser, error, targetSongId, stop, cancel } = useCapture(
    { songId },
  )
  const reduceMotion = useReducedMotion()
  const live = phase === 'starting' || phase === 'recording' || phase === 'interrupted'
  const started = live && phase !== 'starting'
  const showTimer = started || phase === 'saving' || phase === 'saved'

  // Every exit replaces this entry, so Back never returns to /record and starts another take.
  const leave = (target: string | null) => {
    if (target) void navigate({ to: '/songs/$id', params: { id: target }, replace: true })
    else void navigate({ to: '/recordings', replace: true })
  }

  // Until the take is finished, a song deleted in the meantime is only visible in the live row;
  // while that row is still loading, the requested song is the best answer.
  const liveSongId = song === undefined ? songId : (liveSong(song)?.id ?? null)

  const discard = () => {
    if (started && !window.confirm('Discard this recording?')) return
    // A failed discard is reported by the hook and keeps the user on this screen.
    void cancel()
      .then(() => {
        if (liveSongId)
          void navigate({ to: '/songs/$id', params: { id: liveSongId }, replace: true })
        else void navigate({ to: '/', replace: true })
      })
      .catch(() => {})
  }

  const slide = reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }

  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-between gap-6 py-4">
      <header className="text-center">
        <h1 className="text-xl font-semibold">{song ? song.title : 'New recording'}</h1>
        <p role="status" aria-live="polite" className="text-sm opacity-70">
          {STATUS[phase]}
        </p>
      </header>

      <div className="w-full space-y-4">
        <LiveWaveform analyser={analyser} paused={phase !== 'recording'} active={live} />
        {showTimer ? (
          <p
            role="timer"
            aria-live="off"
            className="text-center text-5xl font-semibold tabular-nums"
          >
            {formatDuration(elapsedMs)}
          </p>
        ) : null}
        <AnimatePresence>
          {phase === 'interrupted' ? (
            <motion.p
              role="alert"
              className="bg-warning text-warning-content rounded-box p-3 text-center text-sm"
              initial={slide}
              animate={{ opacity: 1, y: 0 }}
              exit={slide}
            >
              Recording interrupted. The phone locked or another app took the microphone. Stop to
              keep what you have, or wait for it to resume.
            </motion.p>
          ) : null}
        </AnimatePresence>
        {error && phase !== 'saved' ? (
          <p role="alert" className="text-error text-center text-sm">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex w-full flex-col items-center gap-4">
        {live ? (
          <motion.button
            type="button"
            className="btn btn-error h-24 w-24 rounded-full text-lg"
            onClick={() => void stop()}
            disabled={phase === 'starting'}
            animate={reduceMotion || phase !== 'recording' ? { scale: 1 } : { scale: [1, 1.06, 1] }}
            transition={
              reduceMotion || phase !== 'recording'
                ? { duration: 0 }
                : { repeat: Infinity, duration: 1.6, ease: 'easeInOut' }
            }
          >
            Stop
          </motion.button>
        ) : null}
        {phase === 'denied' || phase === 'failed' ? (
          <button type="button" className="btn min-h-11" onClick={() => leave(liveSongId)}>
            Back
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-ghost min-h-11"
            disabled={!live}
            onClick={discard}
          >
            Cancel
          </button>
        )}
      </div>

      <SaveRecordingSheet
        open={phase === 'saved'}
        recordingId={recordingId}
        songId={targetSongId}
        songTitle={song?.title ?? null}
        warning={phase === 'saved' ? error : null}
        onDone={leave}
      />
    </div>
  )
}

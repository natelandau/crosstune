import { useEffect, useState } from 'react'
import { usePlaybackEngine } from '../player/PlaybackEngineProvider'
import { usePlayer } from '../player/usePlayer'
import { decideBack } from '../../platform/backStack'
import { keyPlatform } from '../../platform/keyPlatform'
import { createGoSequence } from '../../ui/goSequence'
import { matchShortcut } from '../../ui/keymap'
import { isControl, isRowTarget, isTextEntry } from '../../ui/keyTarget'
import { useLatest } from '../../ui/useLatest'
import { readBackEntries } from '../../app/backEntries'
import { useDestination } from '../../app/useDestination'
import { useStampedDensity } from '../../platform/density'
import { useQuickFindLauncher } from '../quickFind/quickFindLauncher'
import { useRecordLauncher } from '../../app/recordLauncher'
import { useTuneFormLauncher } from '../tune/formLauncher'
import { useOverlayOpen } from '../../ui/overlayClaim'
import { useShortcutSheet } from './shortcutSheetLauncher'

/**
 * The app's single-key shortcuts, on one window listener. They run at pointer density only, and
 * stand down while an overlay is open, while a text field holds the keystroke, and under any
 * modifier but Shift. A focused control keeps only Space for itself. `focusSearch` focuses the
 * showing screen's search and says whether one was there.
 *
 * Cmd-K or Ctrl-K opens Quick Find at every density, from a text field too, since a chord types
 * nothing. It stands down while another overlay is open, and puts focus back in Quick Find's
 * field while Quick Find shows.
 *
 * Escape steps out of the newest screen state on the back stack, such as selection, at every
 * density, while no overlay is open. Each overlay takes its own Escape, so one press steps out
 * of exactly one thing: the top overlay, then the screen state, then nothing.
 */
export function useShortcuts(focusSearch: () => boolean): void {
  const pointer = useStampedDensity() === 'pointer'
  const engine = usePlaybackEngine()
  const actionsRef = useLatest({
    overlayOpen: useOverlayOpen(),
    recordingLoaded: usePlayer().item?.kind === 'recording',
    focusSearch,
    tuneForm: useTuneFormLauncher(),
    record: useRecordLauncher(),
    sheet: useShortcutSheet(),
    quickFind: useQuickFindLauncher(),
    root: useDestination().root,
  })
  // Date.now, read at each press, so a test's fake clock times the sequence.
  const [go] = useState(() => createGoSequence(() => Date.now()))

  useEffect(() => {
    if (!pointer) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const actions = actionsRef.current
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        actions.overlayOpen ||
        isTextEntry(event.target)
      ) {
        go.reset()
        return
      }

      const step = go.press(event)
      if (step === 'started') {
        event.preventDefault()
        return
      }
      // The key that breaks the sequence is spent on it, so it runs nothing of its own.
      if (step === 'ended') return
      if (step !== null) {
        event.preventDefault()
        actions.root(step)
        return
      }

      switch (matchShortcut(event, keyPlatform())) {
        case 'search':
          if (actions.focusSearch()) event.preventDefault()
          return
        case 'newTune':
          event.preventDefault()
          actions.tuneForm.open({})
          return
        case 'record':
          if (!actions.record.available) return
          event.preventDefault()
          actions.record.start()
          return
        case 'shortcuts':
          event.preventDefault()
          actions.sheet.open()
          return
        case 'playPause':
          if (!actions.recordingLoaded || isControl(event.target) || isRowTarget(event.target))
            return
          event.preventDefault()
          // A held Space repeats; only the first press toggles.
          if (event.repeat) return
          if (engine.getState().playing) engine.pause()
          else engine.play()
          return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      go.reset()
    }
  }, [actionsRef, engine, go, pointer])

  // Heard at window capture, ahead of Quick Find's own field, which keeps every key it hears.
  useEffect(() => {
    const onCommandK = (event: KeyboardEvent) => {
      if (event.defaultPrevented || matchShortcut(event, keyPlatform()) !== 'quickFind') return
      const { quickFind, overlayOpen } = actionsRef.current
      if (overlayOpen && !quickFind.shown) return
      event.preventDefault()
      quickFind.open()
    }
    window.addEventListener('keydown', onCommandK, true)
    return () => window.removeEventListener('keydown', onCommandK, true)
  }, [actionsRef])

  // Heard at window capture, ahead of a tooltip or row grid that takes Escape on the way down,
  // so one press steps out whatever is showing. An open overlay's claim stands it down.
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (isTextEntry(event.target) || matchShortcut(event, keyPlatform()) !== 'stepOut') return
      const decision = decideBack(readBackEntries(), false)
      if (decision.kind === 'entry' && decision.entry.layer === 'screen') {
        void decision.entry.back()
      }
    }
    window.addEventListener('keydown', onEscape, true)
    return () => window.removeEventListener('keydown', onEscape, true)
  }, [])
}

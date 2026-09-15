let context: AudioContext | null = null
let unlockedByTap = false

/**
 * Create or resume the app's AudioContext. Call this synchronously inside a tap handler:
 * iOS keeps a context suspended unless a user gesture created or resumed it.
 */
export function unlockAudioContext(): AudioContext {
  unlockedByTap = true
  context ??= new AudioContext()
  // A rejected resume() (for example the context closed underneath it) must not surface
  // as an unhandled rejection.
  if (context.state === 'suspended') void context.resume().catch(() => {})
  return context
}

export function getAudioContext(): AudioContext | null {
  return context
}

/** Whether a user tap has unlocked the context this session, so a reload or a restored
 * tab knows to ask for one again instead of starting a take with no gesture behind it. */
export function wasUnlockedByTap(): boolean {
  return unlockedByTap
}

/** Release the iOS audio session between takes without tearing down the context itself. */
export function suspendAudioContext(): void {
  if (context && context.state === 'running') void context.suspend().catch(() => {})
}

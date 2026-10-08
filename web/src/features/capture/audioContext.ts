let context: AudioContext | null = null

/**
 * Create or resume the app's AudioContext. Call this synchronously inside a tap handler:
 * iOS keeps a context suspended unless a user gesture created or resumed it.
 */
export function unlockAudioContext(): AudioContext {
  context ??= new AudioContext()
  // A rejected resume() (for example the context closed underneath it) must not surface
  // as an unhandled rejection.
  if (context.state === 'suspended') void context.resume().catch(() => {})
  return context
}

export function getAudioContext(): AudioContext | null {
  return context
}

/** Release the iOS audio session between recordings without tearing down the context itself. */
export function suspendAudioContext(): void {
  if (context && context.state === 'running') void context.suspend().catch(() => {})
}

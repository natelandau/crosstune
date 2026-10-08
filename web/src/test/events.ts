import { onTestFinished } from 'vitest'

/**
 * Counts the events of `type` that reach the window and pass `match`, so a test can wait until
 * an input it sent has been handled before asserting that nothing came of it.
 */
export function seen(type: string, match: (event: Event) => boolean = () => true): () => number {
  let count = 0
  const listener = (event: Event) => {
    if (match(event)) count += 1
  }
  window.addEventListener(type, listener)
  onTestFinished(() => window.removeEventListener(type, listener))
  return () => count
}

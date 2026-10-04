import { userEvent } from 'vitest/browser'

/**
 * Types `keys` and reports whether a handler claimed the keydown that `matches` picks, or
 * undefined when no such keydown arrived. The verdict is read once the press has finished
 * dispatching rather than from inside a listener, so it holds whatever order the page added its
 * own listeners in, including one added while the press was still on its way.
 */
export async function pressClaimed(
  keys: string,
  matches: (event: KeyboardEvent) => boolean,
): Promise<boolean | undefined> {
  const seen: KeyboardEvent[] = []
  const record = (event: KeyboardEvent) => {
    if (matches(event)) seen.push(event)
  }
  window.addEventListener('keydown', record, { capture: true })
  try {
    await userEvent.keyboard(keys)
  } finally {
    window.removeEventListener('keydown', record, { capture: true })
  }
  return seen.length === 0 ? undefined : seen.some((event) => event.defaultPrevented)
}

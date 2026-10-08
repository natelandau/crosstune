/**
 * One thing a device back press can close: an overlay, such as a sheet or a menu, or a screen
 * state, such as selection mode. Every overlay sits above every screen state.
 */
export interface BackEntry {
  id: string
  layer: 'overlay' | 'screen'
  /**
   * False refuses back while this overlay is on top, as a locked sheet refuses Escape. An
   * overlay that asks before it loses work stays true, with a `back` that asks.
   */
  dismissable: boolean
  back(): void | Promise<void>
}

export type BackDecision =
  { kind: 'entry'; entry: BackEntry } | { kind: 'refused' } | { kind: 'history' } | { kind: 'exit' }

/**
 * What a back press does, given the entries in the order they were registered: the newest
 * overlay, then the newest screen state, then history, then leaving the app at its root.
 */
export function decideBack(entries: readonly BackEntry[], canGoBack: boolean): BackDecision {
  const overlay = entries.findLast((entry) => entry.layer === 'overlay')
  if (overlay) return overlay.dismissable ? { kind: 'entry', entry: overlay } : { kind: 'refused' }
  const screen = entries.findLast((entry) => entry.layer === 'screen')
  if (screen) return { kind: 'entry', entry: screen }
  return canGoBack ? { kind: 'history' } : { kind: 'exit' }
}

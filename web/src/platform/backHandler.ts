import { decideBack, type BackDecision, type BackEntry } from './backStack'

/** The device's back button and gesture, and what the app asks of the device in reply. */
export interface BackAdapter {
  /**
   * Hears each back press, told whether history can go back, and learns what the app decided.
   * Hearing it turns off the device's own back, so the app does all of it. Returns a function
   * that stops listening.
   */
  onBack(handler: (canGoBack: boolean) => BackDecision): () => void
  historyBack(): void
  exit(): void
}

/** The browser handles its own back button, and a page has nothing to exit. */
export const webBackAdapter: BackAdapter = {
  onBack: () => () => {},
  historyBack: () => {},
  exit: () => {},
}

/**
 * Answers each back press from `read()`, the open entries at that moment, in order, and
 * returns what it decided.
 */
export function installBackHandler(adapter: BackAdapter, read: () => BackEntry[]): () => void {
  return adapter.onBack((canGoBack) => {
    const decision = decideBack(read(), canGoBack)
    if (decision.kind === 'entry') void decision.entry.back()
    else if (decision.kind === 'history') adapter.historyBack()
    else if (decision.kind === 'exit') adapter.exit()
    return decision
  })
}

import type { BackAdapter } from '../platform/backHandler'
import type { BackDecision } from '../platform/backStack'
import type { AppRouter } from '../app/router'

export interface AndroidBackForTest {
  /** The adapter `renderApp` hands the app, going back through the test's router. */
  adapterFor: (router: AppRouter) => BackAdapter
  /** Presses back, as Android's button or gesture does, returning what the app decided. */
  press: () => BackDecision
  /** How many presses asked the app to exit. */
  exits: () => number
}

/**
 * A device back for `renderApp`'s `android` option, so a test presses back the way Android
 * will. History can go back from any entry but the router's first, whose key is `default`.
 */
export function useAndroidBackForTest(): AndroidBackForTest {
  let router: AppRouter | null = null
  let handler: ((canGoBack: boolean) => BackDecision) | null = null
  let exits = 0
  return {
    adapterFor: (routed) => {
      router = routed
      return {
        onBack: (next) => {
          handler = next
          return () => {
            if (handler === next) handler = null
          }
        },
        historyBack: () => void routed.navigate(-1),
        exit: () => {
          exits += 1
        },
      }
    },
    press: () => {
      if (!router || !handler) throw new Error('No app is listening for back')
      return handler(router.state.location.key !== 'default')
    },
    exits: () => exits,
  }
}

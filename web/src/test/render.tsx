import {
  render,
  renderHook,
  type RenderHookResult,
  type RenderResult,
} from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { onTestFinished } from 'vitest'
import { MOUSE_QUERY } from '../platform/pointer'
import { AppMotion } from '../theme/motion'
import { ConfirmProvider } from '../ui/Confirm'
import { ToastProvider } from '../ui/Toast'

export interface AxesOptions {
  density?: 'touch' | 'pointer'
  scheme?: 'light' | 'dark'
}

/**
 * Answers the pointer query with the density asked for, so a root that mounts `useDensity`
 * keeps it. Headless Chromium reports a fine pointer, which would turn every touch test into a
 * pointer one. The real query comes back when the test finishes.
 */
function stubPointer(density: 'touch' | 'pointer'): void {
  const original = window.matchMedia
  window.matchMedia = (query: string) =>
    query === MOUSE_QUERY
      ? ({
          matches: density === 'pointer',
          media: query,
          addEventListener() {},
          removeEventListener() {},
        } as unknown as MediaQueryList)
      : original.call(window, query)
  onTestFinished(() => {
    window.matchMedia = original
  })
}

export function stampAxes(options: AxesOptions): void {
  const root = document.documentElement
  if (options.density) {
    stubPointer(options.density)
    root.dataset.density = options.density
  }
  if (options.scheme) root.dataset.scheme = options.scheme
  // Runs after the setup's afterEach has unmounted the tree.
  onTestFinished(() => {
    delete root.dataset.density
    delete root.dataset.scheme
  })
}

// eslint-disable-next-line react-refresh/only-export-components
function Providers({ children }: { children: ReactNode }) {
  return (
    <AppMotion>
      <ConfirmProvider>
        <ToastProvider>{children}</ToastProvider>
      </ConfirmProvider>
    </AppMotion>
  )
}

/**
 * Renders inside the app's motion, confirm, and toast providers only, with the density and
 * scheme stamped. Database and sync come from `dataProviders` in `test/providers.tsx`.
 */
export function renderWithProviders(
  ui: ReactElement,
  { density = 'pointer', scheme = 'light' }: AxesOptions = {},
): RenderResult {
  stampAxes({ density, scheme })
  // The app root's motion config, kept across rerenders by passing it as the wrapper.
  return render(ui, { wrapper: Providers })
}

/**
 * Like `renderWithProviders` for a hook. Stamps only the axes named, so a hook that sets one
 * can be tested.
 */
export function renderHookWithProviders<Result, Props>(
  hook: (props: Props) => Result,
  { initialProps, ...axes }: AxesOptions & { initialProps?: Props } = {},
): RenderHookResult<Result, Props> {
  stampAxes(axes)
  return renderHook(hook, { wrapper: Providers, initialProps })
}

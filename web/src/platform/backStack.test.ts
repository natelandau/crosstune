import { expect, it, vi } from 'vitest'
import { decideBack, type BackDecision, type BackEntry } from './backStack'
import { installBackHandler, webBackAdapter, type BackAdapter } from './backHandler'

const entry = (
  id: string,
  layer: BackEntry['layer'],
  dismissable = true,
  back: () => void = () => {},
): BackEntry => ({ id, layer, dismissable, back })

it('gives back to the newer of two overlays', () => {
  const older = entry('sheet', 'overlay')
  const newer = entry('menu', 'overlay')
  expect(decideBack([older, newer], true)).toEqual({ kind: 'entry', entry: newer })
})

it('gives back to an overlay over a screen state, whichever registered first', () => {
  const overlay = entry('menu', 'overlay')
  const screen = entry('selection', 'screen')
  expect(decideBack([overlay, screen], true)).toEqual({ kind: 'entry', entry: overlay })
})

it('gives back to the newest screen state ahead of history', () => {
  const older = entry('selection', 'screen')
  const newer = entry('recording', 'screen')
  expect(decideBack([older, newer], true)).toEqual({ kind: 'entry', entry: newer })
})

it('goes back in history with no entries when history can go back', () => {
  expect(decideBack([], true)).toEqual({ kind: 'history' })
})

it('exits with no entries when history cannot go back', () => {
  expect(decideBack([], false)).toEqual({ kind: 'exit' })
})

it('refuses back while the top overlay is not dismissable, over everything below it', () => {
  const below = entry('menu', 'overlay')
  const locked = entry('form', 'overlay', false)
  const screen = entry('selection', 'screen')
  expect(decideBack([below, locked, screen], true)).toEqual({ kind: 'refused' })
})

function fakeAdapter(canGoBack: boolean) {
  let handler: ((canGoBack: boolean) => BackDecision) | null = null
  const adapter = {
    onBack: vi.fn((next: (canGoBack: boolean) => BackDecision) => {
      handler = next
      return () => {
        handler = null
      }
    }),
    historyBack: vi.fn(),
    exit: vi.fn(),
  } satisfies BackAdapter
  return { adapter, press: () => handler?.(canGoBack), installed: () => handler !== null }
}

it('runs the chosen entry, history, or exit, and reads the entries at each press', () => {
  const close = vi.fn()
  const entries: BackEntry[] = [entry('menu', 'overlay', true, close)]
  const device = fakeAdapter(true)
  const uninstall = installBackHandler(device.adapter, () => entries)

  expect(device.press()).toEqual({ kind: 'entry', entry: entries[0] })
  expect(close).toHaveBeenCalledOnce()
  entries.length = 0
  expect(device.press()).toEqual({ kind: 'history' })
  expect(device.adapter.historyBack).toHaveBeenCalledOnce()
  expect(device.adapter.exit).not.toHaveBeenCalled()

  uninstall()
  expect(device.installed()).toBe(false)
})

it('exits when nothing is open and history cannot go back', () => {
  const device = fakeAdapter(false)
  installBackHandler(device.adapter, () => [])
  expect(device.press()).toEqual({ kind: 'exit' })
  expect(device.adapter.exit).toHaveBeenCalledOnce()
  expect(device.adapter.historyBack).not.toHaveBeenCalled()
})

it('does nothing on a refused back', () => {
  const close = vi.fn()
  const device = fakeAdapter(true)
  installBackHandler(device.adapter, () => [entry('form', 'overlay', false, close)])
  expect(device.press()).toEqual({ kind: 'refused' })
  expect(close).not.toHaveBeenCalled()
  expect(device.adapter.historyBack).not.toHaveBeenCalled()
  expect(device.adapter.exit).not.toHaveBeenCalled()
})

it('leaves the web to the browser, which owns its own back', () => {
  const read = vi.fn(() => [])
  const uninstall = installBackHandler(webBackAdapter, read)
  webBackAdapter.historyBack()
  webBackAdapter.exit()
  uninstall()
  expect(read).not.toHaveBeenCalled()
})

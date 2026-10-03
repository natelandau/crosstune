import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useEntryFocus } from './useEntryFocus'

/** An open screen holding a Back button that is ready only when the test says so. */
function screenWithBack() {
  const modal = document.createElement('div')
  const control = document.createElement('input')
  const back = document.createElement('div')
  const inner = document.createElement('button')
  back.attachShadow({ mode: 'open' }).append(inner)
  let ready = () => {}
  Object.assign(back, {
    componentOnReady: () =>
      new Promise<void>((resolve) => {
        ready = resolve
      }),
  })
  modal.append(control, back)
  document.body.append(modal)
  const refs = {
    target: { current: back as unknown as HTMLIonButtonElement },
    modal: { current: modal as unknown as HTMLIonModalElement },
  }
  return { modal, control, back, refs, ready: () => ready() }
}

function nextFrames() {
  return new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('useEntryFocus', () => {
  it('moves focus to Back once it is ready when nothing on the screen has focus', async () => {
    const { back, refs, ready } = screenWithBack()
    renderHook(() => useEntryFocus(refs.target, refs.modal))
    ready()
    await expect.poll(() => document.activeElement).toBe(back)
  })

  it('leaves focus on a control the musician reached before Back was ready', async () => {
    const { control, refs, ready } = screenWithBack()
    renderHook(() => useEntryFocus(refs.target, refs.modal))
    control.focus()
    ready()
    await nextFrames()
    expect(document.activeElement).toBe(control)
  })

  it('takes focus from a control outside the screen', async () => {
    const { back, refs, ready } = screenWithBack()
    const outside = document.createElement('input')
    document.body.append(outside)
    renderHook(() => useEntryFocus(refs.target, refs.modal))
    outside.focus()
    ready()
    await expect.poll(() => document.activeElement).toBe(back)
  })

  it('does nothing once the screen has gone', async () => {
    const { refs, ready } = screenWithBack()
    const { unmount } = renderHook(() => useEntryFocus(refs.target, refs.modal))
    unmount()
    ready()
    await nextFrames()
    expect(document.activeElement).toBe(document.body)
  })
})

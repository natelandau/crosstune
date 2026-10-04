import { expect, vi } from 'vitest'

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))

/**
 * Ionic's reorder gesture listens for mouse and touch events, not pointer events, and its
 * threshold is zero, so the press itself starts the drag and each move step needs a frame
 * for the gesture's own rAF to run.
 */
export async function dragRow(from: number, to: number) {
  await vi.waitFor(() =>
    expect(document.querySelector('ion-reorder-group')?.className).toContain('reorder-enabled'),
  )
  await frame()
  const handles = document.querySelectorAll<HTMLElement>('ion-reorder-group ion-reorder')
  const start = handles[from]!.getBoundingClientRect()
  const end = handles[to]!.getBoundingClientRect()
  const x = start.left + start.width / 2
  const startY = start.top + start.height / 2
  const endY = end.top + end.height / 2
  const at = (y: number, buttons: number) => ({
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button: 0,
    buttons,
  })
  handles[from]!.dispatchEvent(new MouseEvent('mousedown', at(startY, 1)))
  await frame()
  for (let step = 1; step <= 10; step++) {
    document.dispatchEvent(
      new MouseEvent('mousemove', at(startY + ((endY - startY) * step) / 10, 1)),
    )
    await frame()
  }
  document.dispatchEvent(new MouseEvent('mouseup', at(endY, 0)))
  await frame()
}

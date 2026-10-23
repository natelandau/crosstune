import { render } from '@testing-library/react'
import { useRef } from 'react'
import { MemoryRouter } from 'react-router'
import { expect, it, onTestFinished, vi } from 'vitest'
import { page } from 'vitest/browser'
import { PENDING_GROUP } from './PendingGroup'
import { useLandOnGroup } from './useLandOnGroup'

const SCROLLER = 'scroller'
const INPUT_TYPES = ['pointerdown', 'wheel', 'touchstart', 'keydown']

/**
 * A short scroller over a tall page whose `target` group sits well below the fold, with a group
 * below it still being read.
 */
function Page({ pending = true }: { pending?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useLandOnGroup(ref)
  return (
    <>
      <div data-testid={SCROLLER} style={{ height: 200, overflowY: 'auto' }}>
        <div ref={ref}>
          <div style={{ height: 600 }}>Above</div>
          <section id="target" style={{ height: 600 }}>
            Target <button type="button">Inside</button>
          </section>
          {pending && <div {...{ [PENDING_GROUP]: '' }} hidden />}
        </div>
      </div>
      <button type="button">Outside</button>
    </>
  )
}

function mount(path: string, { pending = true }: { pending?: boolean } = {}) {
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Page pending={pending} />
    </MemoryRouter>,
  )
  const scroller = page.getByTestId(SCROLLER).element() as HTMLElement
  const content = scroller.firstElementChild as HTMLElement
  const target = content.querySelector('#target') as HTMLElement
  return { ...view, scroller, content, target }
}

/** Changes the page's content, resolving once the page's observers have been told. */
async function change(content: HTMLElement, edit: () => void): Promise<void> {
  const seen = new Promise<void>((resolve) => {
    // Observers are told in the order they were made, so this one hears after the hook's.
    const observer = new MutationObserver(() => {
      observer.disconnect()
      resolve()
    })
    observer.observe(content, { childList: true })
  })
  edit()
  await seen
}

/** Adds a block above the target, resolving once the page's observers have been told. */
async function addAbove(content: HTMLElement): Promise<void> {
  const block = document.createElement('div')
  block.style.height = '300px'
  await change(content, () => content.prepend(block))
}

/** The pending group arrives, so every group on the page has rendered. */
async function arriveAll(content: HTMLElement): Promise<void> {
  await change(content, () => content.querySelector(`[${PENDING_GROUP}]`)!.remove())
}

it('lands the named group at the top of the scroller', async () => {
  const { scroller, target } = mount('/page#target')
  await expect.poll(() => scroller.scrollTop).toBe(target.offsetTop - scroller.offsetTop)
})

it('holds the group at the top as content arrives above it', async () => {
  const { scroller, content, target } = mount('/page#target')
  await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0)
  await addAbove(content)
  await expect.poll(() => scroller.scrollTop).toBe(target.offsetTop - scroller.offsetTop)
})

it.each(['wheel', 'pointerdown', 'touchstart', 'keydown'])(
  'lets go of the group after a %s',
  async (type) => {
    const { scroller, content } = mount('/page#target')
    await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0)
    window.dispatchEvent(new Event(type))
    scroller.scrollTop = 0
    await addAbove(content)
    expect(scroller.scrollTop).toBe(0)
  },
)

it('lets go of the group once focus moves into the page', async () => {
  const { scroller, content } = mount('/page#target')
  await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0)
  page.getByRole('button', { name: 'Inside' }).element().dispatchEvent(new FocusEvent('focusin'))
  scroller.scrollTop = 0
  await addAbove(content)
  expect(scroller.scrollTop).toBe(0)
})

it('keeps the group when focus moves somewhere outside the page', async () => {
  const { scroller, content, target } = mount('/page#target')
  await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0)
  page.getByRole('button', { name: 'Outside' }).element().dispatchEvent(new FocusEvent('focusin'))
  await addAbove(content)
  await expect.poll(() => scroller.scrollTop).toBe(target.offsetTop - scroller.offsetTop)
})

it('lets go of the group once every group has rendered', async () => {
  const { scroller, content } = mount('/page#target')
  await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0)
  await arriveAll(content)
  scroller.scrollTop = 0
  await addAbove(content)
  expect(scroller.scrollTop).toBe(0)
})

it('does nothing for a hash that names no group', async () => {
  const { scroller, content } = mount('/page#nowhere')
  await expect.element(page.getByText('Above')).toBeVisible()
  await addAbove(content)
  expect(scroller.scrollTop).toBe(0)
})

it('lets go at once when the named group is absent and nothing is left to arrive', async () => {
  const removed = vi.spyOn(window, 'removeEventListener')
  onTestFinished(() => removed.mockRestore())
  mount('/page#nowhere', { pending: false })
  await expect
    .poll(() => INPUT_TYPES.every((type) => removed.mock.calls.some(([gone]) => gone === type)))
    .toBe(true)
})

it('treats a hash that does not decode as no hash', async () => {
  const { scroller, content } = mount('/page#%E0%A4%A')
  await expect.element(page.getByText('Above')).toBeVisible()
  await addAbove(content)
  expect(scroller.scrollTop).toBe(0)
})

it('leaves no listener behind once unmounted', async () => {
  const added = vi.spyOn(window, 'addEventListener')
  const removed = vi.spyOn(window, 'removeEventListener')
  onTestFinished(() => {
    added.mockRestore()
    removed.mockRestore()
  })
  const { scroller, unmount } = mount('/page#target')
  await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0)
  const capture = (options: unknown) =>
    options === true ||
    (typeof options === 'object' && options !== null && 'capture' in options && options.capture)
  const hooks = [
    added.mock.calls.find(([type]) => type === 'wheel')?.[1],
    added.mock.calls.find(([type]) => type === 'focusin')?.[1],
  ]
  const listeners = added.mock.calls.filter(
    ([, listener, options]) => hooks.includes(listener) && capture(options),
  )
  expect(listeners.map(([type]) => type).sort()).toEqual([...INPUT_TYPES, 'focusin'].sort())
  unmount()
  // Removed with the capture flag each was added with, or the browser keeps it.
  const left = listeners.filter(
    ([type, listener]) =>
      !removed.mock.calls.some(
        ([gone, l, options]) => gone === type && l === listener && capture(options),
      ),
  )
  expect(left).toEqual([])
})

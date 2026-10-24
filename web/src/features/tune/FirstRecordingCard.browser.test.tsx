import { page } from 'vitest/browser'
import { expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/render'
import { FirstRecordingCard } from './FirstRecordingCard'
import { FIND_A_RECORDING, PASTE_LINK, RECORD } from './tuneMediaCopy'

function mount(recordAvailable: boolean) {
  const handlers = { onRecord: vi.fn(), onPaste: vi.fn(), find: vi.fn() }
  renderWithProviders(
    <FirstRecordingCard
      recordAvailable={recordAvailable}
      find={{ label: FIND_A_RECORDING, onPress: handlers.find }}
      onRecord={handlers.onRecord}
      onPaste={handlers.onPaste}
    />,
  )
  return handlers
}

const button = (name: string) => page.getByRole('button', { name, exact: true })

it('offers Record, Paste link, and Find a recording where recording is available', async () => {
  const handlers = mount(true)
  await button(RECORD).click()
  await button(PASTE_LINK).click()
  await button(FIND_A_RECORDING).click()
  await expect.poll(() => handlers.onRecord).toHaveBeenCalledOnce()
  await expect.poll(() => handlers.onPaste).toHaveBeenCalledOnce()
  await expect.poll(() => handlers.find).toHaveBeenCalledOnce()
})

it('leaves Record out where recording is unavailable', async () => {
  mount(false)
  await expect.element(button(PASTE_LINK)).toBeVisible()
  await expect.element(button(FIND_A_RECORDING)).toBeVisible()
  expect(button(RECORD).query()).toBeNull()
})

it('shows the refusal only after a tap, and not again on a later offline spell', async () => {
  const REASON = 'Needs a connection'
  const card = (refused?: string) => (
    <FirstRecordingCard
      recordAvailable
      find={{ label: FIND_A_RECORDING, onPress: vi.fn(), refused }}
      onRecord={vi.fn()}
      onPaste={vi.fn()}
    />
  )
  const { rerender } = renderWithProviders(card(REASON))
  expect(page.getByText(REASON).query()).toBeNull()
  await button(FIND_A_RECORDING).click()
  await expect.element(page.getByText(REASON)).toBeVisible()
  rerender(card(undefined))
  await expect.poll(() => page.getByText(REASON).query()).toBeNull()
  rerender(card(REASON))
  await expect.element(button(FIND_A_RECORDING)).toBeVisible()
  expect(page.getByText(REASON).query()).toBeNull()
})

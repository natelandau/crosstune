import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { useDeleteAndLeave } from './useDeleteAndLeave'
import { renderWithProviders } from '../test/render'
import { Button } from './Button'
import { CANCEL, DELETE, OK, useAlert, useConfirm } from './Confirm'

/** A page that deletes the tune it shows, as the tune page does. */
function Page({ remove, leave }: { remove: (id: string) => void; leave: () => void }) {
  const [tuneId, setTuneId] = useState('a')
  const confirm = useConfirm()
  const { start } = useDeleteAndLeave({
    confirm,
    remove: async () => remove(tuneId),
    leave,
    subject: tuneId,
  })
  return (
    <>
      <p>Showing {tuneId}</p>
      <Button
        label="Delete tune"
        onPress={() =>
          void start(tuneId, { title: `Delete ${tuneId}?`, message: 'It goes.', action: DELETE })
        }
      />
      <Button label="Open b" onPress={() => setTuneId('b')} />
    </>
  )
}

it.each(['touch', 'pointer'] as const)(
  'closes the question when its tune is left, and the next tune asks normally on %s',
  async (density) => {
    const remove = vi.fn()
    const leave = vi.fn()
    renderWithProviders(<Page remove={remove} leave={leave} />, { density })
    await page.getByRole('button', { name: 'Delete tune' }).click()
    await expect.element(page.getByText('Delete a?')).toBeVisible()
    // An open dialog makes the page inert to a real click, so the test clicks the button itself.
    ;(
      page.getByRole('button', { name: 'Open b', includeHidden: true }).element() as HTMLElement
    ).click()
    await expect.element(page.getByText('Showing b')).toBeVisible()
    await expect.poll(() => page.getByText('Delete a?').query()).toBeNull()
    expect(remove).not.toHaveBeenCalled()

    await page.getByRole('button', { name: 'Delete tune' }).click()
    await expect.element(page.getByText('Delete b?')).toBeVisible()
    await page.getByRole('button', { name: DELETE }).click()
    await expect.poll(() => remove).toHaveBeenCalledExactlyOnceWith('b')
    await expect.poll(() => leave).toHaveBeenCalledOnce()
  },
)

function AlertPage({ onClosed }: { onClosed: () => void }) {
  const alert = useAlert()
  return (
    <Button
      label="Fail"
      onPress={() => void alert({ title: 'It failed', message: 'Try again.' }).then(onClosed)}
    />
  )
}

it.each(['touch', 'pointer'] as const)(
  'an alert offers OK alone and resolves once OK closes it on %s',
  async (density) => {
    const onClosed = vi.fn()
    renderWithProviders(<AlertPage onClosed={onClosed} />, { density })
    await page.getByRole('button', { name: 'Fail' }).click()

    await expect.element(page.getByText('Try again.')).toBeVisible()
    expect(page.getByRole('button', { name: CANCEL }).query()).toBeNull()
    await page.getByRole('button', { name: OK }).click()

    await expect.poll(() => onClosed).toHaveBeenCalledOnce()
    await expect.element(page.getByText('Try again.')).not.toBeInTheDocument()
  },
)

import { IonButton } from '@ionic/react'
import { screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { openTestDb } from '../test/db'
import { renderIonic } from '../test/ionic'
import { forceTouch } from '../test/pointer'
import { Sheet } from './Sheet'

function modal(): HTMLIonModalElement {
  const element = document.querySelector<HTMLIonModalElement>('ion-modal')
  if (!element) throw new Error('No sheet is mounted')
  return element
}

function Host({ height }: { height?: 'sheet' | 'full' }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <IonButton onClick={() => setOpen(true)}>Open</IonButton>
      <Sheet
        open={open}
        title="Lyrics"
        height={height}
        onClose={() => setOpen(false)}
        end={<IonButton>Save</IonButton>}
      >
        <p>body</p>
      </Sheet>
    </>
  )
}

let restore: () => void

beforeEach(() => {
  restore = forceTouch()
})

afterEach(() => {
  restore()
  vi.resetAllMocks()
})

it('opens a full sheet at the top breakpoint', async () => {
  renderIonic(<Host height="full" />, { db: openTestDb() })
  await userEvent.click(await screen.findByText('Open'))
  await vi.waitFor(() => expect(modal().initialBreakpoint).toBe(1))
  expect(modal().breakpoints).toEqual([0, 1])
})

it('opens a plain sheet part way, at its default height', async () => {
  renderIonic(<Host />, { db: openTestDb() })
  await userEvent.click(await screen.findByText('Open'))
  await vi.waitFor(() => expect(modal().initialBreakpoint).toBe(0.6))
  expect(modal().breakpoints).toEqual([0, 0.6, 1])
})

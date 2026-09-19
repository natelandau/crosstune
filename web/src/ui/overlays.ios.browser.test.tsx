import { IonButton } from '@ionic/react'
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { MOUSE_QUERY } from '../platform/pointer'
import { openTestDb } from '../test/db'
import { renderIonic } from '../test/ionic'
import { useConfirm } from './Confirm'

const originalMatchMedia = window.matchMedia

afterEach(() => {
  window.matchMedia = originalMatchMedia
})

function forceTouch() {
  window.matchMedia = (query: string) =>
    query === MOUSE_QUERY
      ? ({
          matches: false,
          media: query,
          addEventListener() {},
          removeEventListener() {},
        } as unknown as MediaQueryList)
      : originalMatchMedia.call(window, query)
}

function ConfirmHost() {
  const confirm = useConfirm()
  return (
    <IonButton
      onClick={() =>
        void confirm({
          title: 'Delete "Soldier\'s Joy"?',
          message: 'This removes 3 recordings.',
          action: 'Delete',
        })
      }
    >
      Delete song
    </IonButton>
  )
}

/** The palette's danger color as the browser computes it, so the palette itself can change. */
function dangerColor(): string {
  const probe = document.createElement('span')
  probe.style.color = 'var(--ion-color-danger)'
  document.body.append(probe)
  try {
    return getComputedStyle(probe).color
  } finally {
    probe.remove()
  }
}

async function openConfirm() {
  renderIonic(<ConfirmHost />, { db: openTestDb() })
  await userEvent.click(await screen.findByText('Delete song'))
  await expect.element(await screen.findByText('This removes 3 recordings.')).toBeVisible()
  const destructive = document.querySelector<HTMLElement>(
    '.alert-button-role-destructive, .action-sheet-destructive',
  )
  const cancel = document.querySelector<HTMLElement>(
    '.alert-button-role-cancel, .action-sheet-cancel',
  )
  if (!destructive || !cancel) throw new Error('no confirmation is up')
  return { destructive, cancel }
}

// The danger color is what tells a destructive confirmation apart from its Cancel, and Ionic
// gives it per mode, so each mode asserts it for itself.
describe('useConfirm in ios', () => {
  it('paints the alert on a mouse in the danger color', async () => {
    const { destructive, cancel } = await openConfirm()
    expect(getComputedStyle(destructive).color).toBe(dangerColor())
    expect(getComputedStyle(cancel).color).not.toBe(dangerColor())
  })

  it('paints the action sheet on touch in the danger color', async () => {
    forceTouch()
    const { destructive, cancel } = await openConfirm()
    expect(getComputedStyle(destructive).color).toBe(dangerColor())
    expect(getComputedStyle(cancel).color).not.toBe(dangerColor())
  })
})

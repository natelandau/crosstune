import { expect, vi } from 'vitest'
import { page } from 'vitest/browser'

/** The modal on screen now, if any. A dismissed one can stay in the page, hidden. */
export const presentedModal = () =>
  document.querySelector<HTMLElement>('ion-modal:not(.overlay-hidden)')

/** The shown modal, once there is one. Its contents are slotted into, not under, the role its
 * shadow root holds, so the locator is rooted at the element. */
export async function modal() {
  await expect.poll(presentedModal).not.toBeNull()
  return page.elementLocator(presentedModal()!)
}

async function shown(tag: 'ion-popover' | 'ion-alert', what: string): Promise<HTMLElement> {
  return vi.waitFor(() => {
    const open = document.querySelector<HTMLElement>(`${tag}:not(.overlay-hidden)`)
    if (!open) throw new Error(`${what} is not open`)
    return open
  })
}

/** An item in the open popover menu. Scoped to it, since a menu dismissing behind it, or the
 * page under it, can carry the same words. */
export async function menuItem(label: string) {
  return page.elementLocator(await shown('ion-popover', 'The menu')).getByText(label, {
    exact: true,
  })
}

/** A button in the open confirmation. Scoped to it, since it can open while the menu that
 * asked for it is still dismissing. */
export async function alertButton(name: string) {
  return page.elementLocator(await shown('ion-alert', 'The confirmation')).getByRole('button', {
    name,
    exact: true,
  })
}

/** Opens a picker row by the button name it carries. The row takes the click because Ionic's own
 * inner button takes none. Ionic ignores a present while the previous popover is still
 * dismissing, and its hidden class arrives before the dismissal reaches React, so the wait is
 * for every popover to leave the page. */
export async function openPickerRow(name: string, { exact }: { exact?: boolean } = {}) {
  await vi.waitFor(() => expect(document.querySelector('ion-popover')).toBeNull())
  await page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name, exact }) })
    .click()
}

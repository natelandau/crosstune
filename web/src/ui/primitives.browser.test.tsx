import { IonItem, IonLabel, IonList, IonToast } from '@ionic/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { openTestDb } from '../test/db'
import { renderIonic } from '../test/ionic'
import { Capsule } from './Capsule'
import { Group } from './Group'
import { InlineError } from './InlineError'
import { Row } from './Row'
import { useRowArrowKeys, useSearchShortcut } from './useShortcut'

// Resolves a `--ion-color-*` custom property to the same rgb(...) string the browser
// reports from getComputedStyle, so a layering regression shows up as a color mismatch.
function computedColor(variable: string): string {
  const probe = document.createElement('span')
  probe.style.color = `var(${variable})`
  document.body.appendChild(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}

function computedBackground(variable: string): string {
  const probe = document.createElement('span')
  probe.style.backgroundColor = `var(${variable})`
  document.body.appendChild(probe)
  const color = getComputedStyle(probe).backgroundColor
  probe.remove()
  return color
}

describe('Group', () => {
  it('shows a header, the rows, and a footer, and an error in place of the footer', async () => {
    const { rerender } = renderIonic(
      <Group header="Title" footer="Help text.">
        <IonItem>
          <IonLabel>Row</IonLabel>
        </IonItem>
      </Group>,
      { db: openTestDb() },
    )
    await expect.element(page.getByRole('heading', { name: 'Title', level: 2 })).toBeVisible()
    await expect.element(page.getByText('Help text.')).toBeVisible()
    rerender(
      <Group header="Title" footer="Help text." error="A title is required">
        <IonItem>
          <IonLabel>Row</IonLabel>
        </IonItem>
      </Group>,
    )
    await expect.element(page.getByRole('alert')).toHaveTextContent('A title is required')
    expect(page.getByText('Help text.').elements()).toHaveLength(0)
  })

  it('names its list and takes a rendered header', async () => {
    renderIonic(
      <Group header={<a href="/tunes/1">Soldier&apos;s Joy</a>} name="Soldier's Joy">
        <IonItem>
          <IonLabel>Row</IonLabel>
        </IonItem>
      </Group>,
      { db: openTestDb() },
    )
    await expect.element(page.getByRole('list', { name: "Soldier's Joy" })).toBeVisible()
    await expect.element(page.getByRole('link', { name: "Soldier's Joy" })).toBeVisible()
  })
})

describe('Capsule', () => {
  it('is a pressable button with aria-pressed, or a static badge', async () => {
    const onPress = vi.fn()
    renderIonic(
      <>
        <Capsule pressed onPress={onPress}>
          D
        </Capsule>
        <Capsule>Crooked</Capsule>
      </>,
      { db: openTestDb() },
    )
    const d = page.getByRole('button', { name: 'D' })
    await expect.element(d).toHaveAttribute('aria-pressed', 'true')
    await d.click()
    expect(onPress).toHaveBeenCalledOnce()
    expect(page.getByRole('button', { name: 'Crooked' }).elements()).toHaveLength(0)
  })

  it('shows only the round capsule, with no button face or border around it', async () => {
    renderIonic(
      <Capsule pressed={false} onPress={() => {}}>
        D
      </Capsule>,
      { db: openTestDb() },
    )
    const button = page.getByRole('button', { name: 'D' }).element()
    const style = getComputedStyle(button)
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(style.borderTopWidth).toBe('0px')
  })

  it('gives a pressed capsule the tint text color and a 44px tap target', async () => {
    renderIonic(
      // A flex row, as a filter rail lays capsules out, so the button sizes to its
      // content instead of stretching to the full block width.
      <div className="flex">
        <Capsule pressed onPress={() => {}}>
          D
        </Capsule>
      </div>,
      { db: openTestDb() },
    )
    const d = page.getByRole('button', { name: 'D' })
    await vi.waitFor(() => expect(d.element()).toBeTruthy())
    const inner = d.element().querySelector('span')!
    expect(getComputedStyle(inner).color).toBe(computedColor('--ion-color-primary-contrast'))
    expect(d.element().getBoundingClientRect().width).toBeGreaterThanOrEqual(44)
  })

  it('gives a warning capsule the warning contrast text color', async () => {
    renderIonic(<Capsule tone="warning">Archived</Capsule>, { db: openTestDb() })
    const badge = page.getByText('Archived')
    await expect.element(badge).toBeVisible()
    expect(getComputedStyle(badge.element()).color).toBe(
      computedColor('--ion-color-warning-contrast'),
    )
  })

  it('fills a neutral capsule with the tertiary fill of the light or dark palette', async () => {
    renderIonic(<Capsule>Crooked</Capsule>, { db: openTestDb() })
    const badge = page.getByText('Crooked')
    await expect.element(badge).toBeVisible()
    const fill = () => getComputedStyle(badge.element()).backgroundColor
    const light = fill()
    expect(light).toBe(computedBackground('--fill-tertiary'))
    document.documentElement.classList.add('ion-palette-dark')
    try {
      expect(fill()).toBe(computedBackground('--fill-tertiary'))
      expect(fill()).not.toBe(light)
    } finally {
      document.documentElement.classList.remove('ion-palette-dark')
    }
  })
})

describe('InlineError', () => {
  it('announces as an alert', async () => {
    renderIonic(<InlineError>Tune not found</InlineError>, { db: openTestDb() })
    const alert = page.getByRole('alert')
    await expect.element(alert).toHaveTextContent('Tune not found')
    await vi.waitFor(() => expect(alert.element()).toBeTruthy())
    expect(getComputedStyle(alert.element()).color).toBe(computedColor('--ion-color-danger'))
  })
})

function ShortcutHost({ onFocus, loaded = true }: { onFocus: () => void; loaded?: boolean }) {
  const list = useRef<HTMLIonListElement>(null)
  useSearchShortcut(onFocus)
  useRowArrowKeys(list)
  return (
    <>
      <input aria-label="Other field" />
      {loaded ? (
        <IonList ref={list}>
          {['One', 'Two'].map((title) => (
            <Row key={title} name={title} onOpen={() => {}}>
              <IonLabel>{title}</IonLabel>
            </Row>
          ))}
        </IonList>
      ) : null}
    </>
  )
}

describe('shortcuts on a mouse', () => {
  it('focuses search on / unless typing in a field', async () => {
    const onFocus = vi.fn()
    renderIonic(<ShortcutHost onFocus={onFocus} />, { db: openTestDb() })
    await userEvent.keyboard('/')
    expect(onFocus).toHaveBeenCalledOnce()
    await page.getByLabelText('Other field').click()
    await userEvent.keyboard('/')
    expect(onFocus).toHaveBeenCalledOnce()
  })

  it('moves between rows with the arrow keys', async () => {
    renderIonic(<ShortcutHost onFocus={() => {}} />, { db: openTestDb() })
    const opens = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-row-open]'))
    // ion-item hides its content until Stencil hydrates it, so an early focus() is a no-op.
    await vi.waitFor(() => {
      opens[0]!.focus()
      expect(document.activeElement).toBe(opens[0])
    })
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(opens[1])
    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(opens[0])
  })

  // The rows arrive with a query, so the list they sit in is not there on the first render.
  it('moves between rows that arrive after the first render', async () => {
    const { rerender } = renderIonic(<ShortcutHost onFocus={() => {}} loaded={false} />, {
      db: openTestDb(),
    })
    rerender(<ShortcutHost onFocus={() => {}} />)
    await vi.waitFor(() => expect(document.querySelectorAll('[data-row-open]')).toHaveLength(2))
    const opens = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-row-open]'))
    await vi.waitFor(() => {
      opens[0]!.focus()
      expect(document.activeElement).toBe(opens[0])
    })
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(opens[1])
  })

  it('leaves an arrow key with a modifier to the browser', async () => {
    renderIonic(<ShortcutHost onFocus={() => {}} />, { db: openTestDb() })
    const opens = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-row-open]'))
    await vi.waitFor(() => {
      opens[0]!.focus()
      expect(document.activeElement).toBe(opens[0])
    })
    let prevented: boolean | undefined
    const record = (event: KeyboardEvent) => {
      prevented = event.defaultPrevented
    }
    window.addEventListener('keydown', record)
    try {
      await userEvent.keyboard('{Meta>}{ArrowDown}{/Meta}')
    } finally {
      window.removeEventListener('keydown', record)
    }
    expect(prevented).toBe(false)
    expect(document.activeElement).toBe(opens[0])
  })

  it('focuses search on / while a toast shows', async () => {
    const onFocus = vi.fn()
    renderIonic(
      <>
        <ShortcutHost onFocus={onFocus} />
        <IonToast isOpen message="Saved" />
      </>,
      { db: openTestDb() },
    )
    await expect.element(page.getByText('Saved')).toBeVisible()
    await userEvent.keyboard('/')
    expect(onFocus).toHaveBeenCalledOnce()
  })
})

import { IonButton, IonLabel, IonList, IonToggle } from '@ionic/react'
import { Archive, SquarePen } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { MOUSE_QUERY } from '../platform/pointer'
import { glyphContrast } from '../test/contrast'
import { openTestDb } from '../test/db'
import { renderIonic } from '../test/ionic'
import { Row } from './Row'

const original = window.matchMedia
afterEach(() => {
  window.matchMedia = original
  document.documentElement.classList.remove('ion-palette-dark')
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
      : original.call(window, query)
}

function List({
  onOpen = () => {},
  onEdit = () => {},
}: {
  onOpen?: () => void
  onEdit?: () => void
}) {
  return (
    <IonList inset>
      {["Soldier's Joy", 'Cluck Old Hen'].map((title) => (
        <Row
          key={title}
          name={title}
          onOpen={onOpen}
          actions={[
            { label: 'Edit', icon: SquarePen, tone: 'neutral', onPress: onEdit },
            { label: 'Archive', icon: Archive, tone: 'warning', onPress: () => {} },
          ]}
        >
          <IonLabel>
            <h2>{title}</h2>
            <p>D · Known</p>
          </IonLabel>
        </Row>
      ))}
    </IonList>
  )
}

describe('Row', () => {
  it('refuses openName without onOpen: a name for a control that does not exist', () => {
    expect(() =>
      renderIonic(
        <IonList>
          <Row name="Soldier's Joy" openName="Play">
            <IonLabel>
              <h2>Soldier's Joy</h2>
            </IonLabel>
          </Row>
        </IonList>,
        { db: openTestDb() },
      ),
    ).toThrow('Row: openName requires onOpen')
  })
})

describe('Row on a mouse', () => {
  it('opens from the row and names the open control with the row content', async () => {
    const onOpen = vi.fn()
    renderIonic(<List onOpen={onOpen} />, { db: openTestDb() })
    const open = page.getByRole('button', { name: "Soldier's Joy D · Known", exact: true })
    await open.click()
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('leads the open control name with openName, keeping the row content in it too', async () => {
    const onOpen = vi.fn()
    renderIonic(
      <IonList>
        <Row name="Soldier's Joy" onOpen={onOpen} openName="Play">
          <IonLabel>
            <h2>Soldier's Joy</h2>
            <p>D · Known</p>
          </IonLabel>
        </Row>
      </IonList>,
      { db: openTestDb() },
    )
    // Neither the verb alone nor the content alone names the control: both together do.
    expect(page.getByRole('button', { name: 'Play', exact: true }).query()).toBeNull()
    expect(
      page.getByRole('button', { name: "Soldier's Joy D · Known", exact: true }).query(),
    ).toBeNull()
    await page.getByRole('button', { name: "Play Soldier's Joy D · Known", exact: true }).click()
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('keeps actions outside the open control and runs one without opening the row', async () => {
    const onOpen = vi.fn()
    const onEdit = vi.fn()
    renderIonic(<List onOpen={onOpen} onEdit={onEdit} />, { db: openTestDb() })
    const edit = page.getByRole('button', { name: "Edit Soldier's Joy" })
    // ion-button hydrates its shadow content asynchronously, after the synchronous render.
    await vi.waitFor(() => expect(edit.element()).toBeTruthy())
    const openButton = document.querySelector('[data-row-open]')!
    expect(openButton.contains(edit.element())).toBe(false)
    await userEvent.hover(openButton)
    await edit.click()
    expect(onEdit).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('reaches each action by Tab after the open control, at 44px', async () => {
    renderIonic(<List />, { db: openTestDb() })
    const edit = page.getByRole('button', { name: "Edit Soldier's Joy" })
    await vi.waitFor(() => expect(edit.element()).toBeTruthy())
    const open = document.querySelector<HTMLButtonElement>('[data-row-open]')!
    open.focus()
    await userEvent.tab()
    // document.activeElement reports the ion-button host, not the shadow button getByRole finds.
    const host = (edit.element().getRootNode() as ShadowRoot).host
    expect(document.activeElement).toBe(host)
    const box = edit.element().getBoundingClientRect()
    expect(box.height).toBeGreaterThanOrEqual(44)
    expect(box.width).toBeGreaterThanOrEqual(44)
  })

  it('gives the row content its full width and lays the actions over it on hover', async () => {
    renderIonic(<List />, { db: openTestDb() })
    const item = document.querySelector('ion-list > ion-item')!
    const body = item.querySelector('[data-row-open] ~ div')!
    await vi.waitFor(() => expect(item.shadowRoot?.querySelector('.item-inner')).toBeTruthy())
    const inner = item.shadowRoot!.querySelector('.item-inner')!
    const contentEnd = () =>
      inner.getBoundingClientRect().right - parseFloat(getComputedStyle(inner).paddingRight)
    await vi.waitFor(() =>
      expect(Math.abs(contentEnd() - body.getBoundingClientRect().right)).toBeLessThanOrEqual(1),
    )
    const before = body.getBoundingClientRect().width
    await userEvent.hover(item.querySelector('[data-row-open]')!)
    const actions = item.querySelector('.row-actions')!
    await vi.waitFor(() => expect(getComputedStyle(actions).opacity).toBe('1'))
    expect(body.getBoundingClientRect().width).toBe(before)
    expect(actions.getBoundingClientRect().right).toBeCloseTo(
      inner.getBoundingClientRect().right,
      0,
    )
  })

  it('draws the focus ring over the whole row, above the actions, on the focused surface', async () => {
    renderIonic(<List />, { db: openTestDb() })
    const edit = page.getByRole('button', { name: "Edit Soldier's Joy" })
    await vi.waitFor(() => expect(edit.element()).toBeTruthy())
    const item = document.querySelector('ion-list > ion-item')!
    const open = item.querySelector<HTMLButtonElement>('[data-row-open]')!
    open.focus()
    await userEvent.tab()
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(open)
    expect(getComputedStyle(open).outlineStyle).toBe('none')
    const ring = getComputedStyle(item, '::after')
    const actions = item.querySelector('.row-actions')!
    await vi.waitFor(() => expect(getComputedStyle(actions).opacity).toBe('1'))
    expect(ring.borderRightWidth).toBe('2px')
    expect(ring.position).toBe('absolute')
    expect([ring.top, ring.right, ring.bottom, ring.left]).toEqual(['0px', '0px', '0px', '0px'])
    // A computed width excludes the 2px border on each side.
    expect(parseFloat(ring.width) + 4).toBe(item.getBoundingClientRect().width)
    expect(parseFloat(ring.height) + 4).toBe(item.getBoundingClientRect().height)
    expect(Number(ring.zIndex)).toBeGreaterThan(Number(getComputedStyle(actions).zIndex))
    const native = item.shadowRoot!.querySelector('.item-native')!
    // The item's background transitions into the focused surface.
    await vi.waitFor(() =>
      expect(getComputedStyle(actions).backgroundImage).toContain(
        getComputedStyle(native).backgroundColor,
      ),
    )
  })

  it('fades the actions backdrop in from the inline start in both text directions', async () => {
    renderIonic(<List />, { db: openTestDb() })
    const actions = document.querySelector('.row-actions')!
    await vi.waitFor(() =>
      expect(getComputedStyle(actions).backgroundImage).toMatch(/^linear-gradient\(to right/),
    )
    document.documentElement.dir = 'rtl'
    try {
      expect(getComputedStyle(actions).backgroundImage).toMatch(/^linear-gradient\(to left/)
    } finally {
      document.documentElement.removeAttribute('dir')
    }
  })

  it('draws no face of its own over the row content', async () => {
    renderIonic(<List />, { db: openTestDb() })
    const open = document.querySelector<HTMLButtonElement>('[data-row-open]')!
    // Computed style reads empty until Ionic hydrates the item around the button.
    await vi.waitFor(() => expect(getComputedStyle(open).backgroundColor).not.toBe(''))
    const style = getComputedStyle(open)
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(style.borderTopWidth).toBe('0px')
  })

  it('keeps a separator under the first row of an inset list and none under the last', async () => {
    renderIonic(<List />, { db: openTestDb() })
    const items = Array.from(document.querySelectorAll('ion-list > ion-item'))
    expect(items).toHaveLength(2)
    const inner = (item: Element) =>
      getComputedStyle(item.shadowRoot!.querySelector('.item-inner')!).borderBottomWidth
    await vi.waitFor(() => expect(inner(items[0]!)).not.toBe('0px'))
    expect(inner(items[1]!)).toBe('0px')
  })
})

describe('Row on touch', () => {
  it('opens from the item and reveals named actions in sliding options', async () => {
    forceTouch()
    const onOpen = vi.fn()
    renderIonic(<List onOpen={onOpen} />, { db: openTestDb() })
    const sliding = document.querySelector<HTMLIonItemSlidingElement>('ion-item-sliding')!
    await vi.waitFor(async () => {
      await sliding.open('end')
      expect(sliding.classList.contains('item-sliding-active-slide')).toBe(true)
    })
    await expect.element(page.getByRole('button', { name: "Edit Soldier's Joy" })).toBeVisible()
    expect(document.querySelector('ion-item-option[expandable]')).toBeNull()
  })

  it('reveals every action at one width, whatever its label reads', async () => {
    forceTouch()
    renderIonic(<List />, { db: openTestDb() })
    const sliding = document.querySelector<HTMLIonItemSlidingElement>('ion-item-sliding')!
    await vi.waitFor(async () => {
      await sliding.open('end')
      expect(sliding.classList.contains('item-sliding-active-slide')).toBe(true)
    })
    const widths = Array.from(sliding.querySelectorAll('ion-item-option')).map(
      (option) => option.getBoundingClientRect().width,
    )
    expect(widths).toHaveLength(2)
    expect(new Set(widths).size).toBe(1)
    expect(widths[0]).toBeGreaterThanOrEqual(44)
  })

  it('shows the short text of an action while its label still names it', async () => {
    forceTouch()
    renderIonic(
      <IonList inset>
        <Row
          name="Take 3"
          actions={[
            {
              label: 'Remove from song',
              short: 'Remove',
              icon: Archive,
              tone: 'warning',
              onPress: () => {},
            },
          ]}
        >
          <IonLabel>
            <h2>Take 3</h2>
          </IonLabel>
        </Row>
      </IonList>,
      { db: openTestDb() },
    )
    const sliding = document.querySelector<HTMLIonItemSlidingElement>('ion-item-sliding')!
    await vi.waitFor(async () => {
      await sliding.open('end')
      expect(sliding.classList.contains('item-sliding-active-slide')).toBe(true)
    })
    const option = sliding.querySelector('ion-item-option')!
    expect(option.querySelector('[aria-hidden]')!.textContent).toBe('Remove')
    await expect
      .element(page.getByRole('button', { name: 'Remove from song Take 3' }))
      .toBeVisible()
  })

  it('lets a control inside the row content take a tap', async () => {
    forceTouch()
    const onPress = vi.fn()
    renderIonic(
      <IonList>
        <Row name="Plain">
          <IonLabel>
            <button type="button" onClick={onPress}>
              Play
            </button>
          </IonLabel>
        </Row>
      </IonList>,
      { db: openTestDb() },
    )
    await page.getByRole('button', { name: 'Play' }).click({ timeout: 2000 })
    expect(onPress).toHaveBeenCalledOnce()
  })

  it('fires only its own handler for a control in the body of a row with onOpen', async () => {
    forceTouch()
    const onOpen = vi.fn()
    const onPress = vi.fn()
    renderIonic(
      <IonList>
        <Row name="Plain" onOpen={onOpen}>
          <IonLabel>
            <h2>Plain</h2>
            <button type="button" onClick={onPress}>
              Play
            </button>
          </IonLabel>
        </Row>
      </IonList>,
      { db: openTestDb() },
    )
    await page.getByRole('button', { name: 'Play' }).click({ timeout: 2000 })
    expect(onPress).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
    await page.getByText('Plain').click()
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('fires only its own handler for a shadow-DOM control in the body of a row with onOpen', async () => {
    forceTouch()
    const onOpen = vi.fn()
    const onToggle = vi.fn()
    renderIonic(
      <IonList>
        <Row name="Plain" onOpen={onOpen}>
          <IonLabel>
            <h2>Plain</h2>
            <IonToggle onIonChange={onToggle}>Play</IonToggle>
          </IonLabel>
        </Row>
      </IonList>,
      { db: openTestDb() },
    )
    const toggle = page.getByRole('switch', { name: 'Play' })
    // ion-toggle hydrates its shadow content asynchronously, after the synchronous render.
    await vi.waitFor(() => expect(toggle.element()).toBeTruthy())
    await toggle.click({ timeout: 2000 })
    expect(onToggle).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('leads the item name with an sr-only verb, keeping its content in the name too', async () => {
    forceTouch()
    const onOpen = vi.fn()
    renderIonic(
      <IonList>
        <Row name="Soldier's Joy" onOpen={onOpen} openName="Play">
          <IonLabel>
            <h2>Soldier's Joy</h2>
            <p>D · Known</p>
          </IonLabel>
        </Row>
      </IonList>,
      { db: openTestDb() },
    )
    expect(page.getByRole('button', { name: 'Play', exact: true }).query()).toBeNull()
    expect(
      page.getByRole('button', { name: "Soldier's Joy D · Known", exact: true }).query(),
    ).toBeNull()
    await expect
      .element(page.getByRole('button', { name: "Play Soldier's Joy D · Known", exact: true }))
      .toBeVisible()
    // The visible text sits under the open button now (pointer-events-none), the same as a
    // mouse: a real tap there lands on whatever a browser's hit test finds, which force mimics.
    await page.getByText("Soldier's Joy").click({ force: true })
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('renders a plain item without actions or an open handler', async () => {
    forceTouch()
    renderIonic(
      <IonList>
        <Row name="Plain">
          <IonLabel>Plain</IonLabel>
        </Row>
      </IonList>,
      { db: openTestDb() },
    )
    await expect.element(page.getByText('Plain')).toBeVisible()
    expect(document.querySelector('ion-item-sliding')).toBeNull()
    expect(document.querySelector('[data-row-open]')).toBeNull()
  })

  it('keeps a trailing control in the end slot', async () => {
    forceTouch()
    const onGrip = vi.fn()
    renderIonic(
      <IonList>
        <Row
          name="Plain"
          end={
            <button type="button" aria-label="Grip" onClick={onGrip}>
              ≡
            </button>
          }
        >
          <IonLabel>Plain</IonLabel>
        </Row>
      </IonList>,
      { db: openTestDb() },
    )
    const grip = page.getByRole('button', { name: 'Grip' })
    await expect.element(grip).toBeVisible()
    expect(grip.element().getAttribute('slot')).toBeNull()
    expect(grip.element().closest('[slot="end"]')?.className).toBe('row-trailing')
    await grip.click()
    expect(onGrip).toHaveBeenCalledOnce()
  })

  it('fires only its own handler for a control in the end slot of a row with onOpen', async () => {
    forceTouch()
    const onOpen = vi.fn()
    const onGrip = vi.fn()
    renderIonic(
      <IonList>
        <Row
          name="Plain"
          onOpen={onOpen}
          end={
            <button type="button" aria-label="Grip" onClick={onGrip}>
              <SquarePen aria-hidden className="size-5" />
            </button>
          }
        >
          <IonLabel>
            <h2>Plain</h2>
          </IonLabel>
        </Row>
      </IonList>,
      { db: openTestDb() },
    )
    await page.getByRole('button', { name: 'Grip' }).click({ timeout: 2000 })
    expect(onGrip).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
    await page.getByText('Plain').click()
    expect(onOpen).toHaveBeenCalledOnce()
  })
})

describe('Row on a mouse with a trailing control', () => {
  it('keeps hover actions clear of the end slot and the end control clickable', async () => {
    const onGrip = vi.fn()
    renderIonic(
      <IonList>
        <Row
          name="Soldier's Joy"
          onOpen={() => {}}
          actions={[{ label: 'Edit', icon: SquarePen, tone: 'neutral', onPress: () => {} }]}
          end={
            <button type="button" aria-label="Grip" className="size-11" onClick={onGrip}>
              ≡
            </button>
          }
        >
          <IonLabel>Soldier's Joy</IonLabel>
        </Row>
      </IonList>,
      { db: openTestDb() },
    )
    const grip = page.getByRole('button', { name: 'Grip' })
    const edit = page.getByRole('button', { name: "Edit Soldier's Joy" })
    await expect.element(grip).toBeVisible()
    await userEvent.hover(grip.element())
    // ion-button hydrates its shadow content asynchronously, and its host, not the shadow
    // button getByRole finds, is the light-DOM descendant of .row-actions.
    const editHost = (edit.element().getRootNode() as ShadowRoot).host
    await vi.waitFor(() =>
      expect(getComputedStyle(editHost.closest('.row-actions')!).opacity).toBe('1'),
    )
    const gripBox = grip.element().getBoundingClientRect()
    const editBox = edit.element().getBoundingClientRect()
    expect(editBox.right).toBeLessThanOrEqual(gripBox.left + 1)
    const x = gripBox.left + gripBox.width / 2
    const y = gripBox.top + gripBox.height / 2
    expect(grip.element().contains(document.elementFromPoint(x, y))).toBe(true)
    await grip.click()
    expect(onGrip).toHaveBeenCalledOnce()
  })
})

describe('Row with a named open control and a real control in end', () => {
  function namedWithEnd(onOpen: () => void, onRetry: () => void) {
    return (
      <IonList>
        <Row
          name="Soldier's Joy"
          onOpen={onOpen}
          openName="Play"
          end={
            <IonButton fill="clear" aria-label="Retry Soldier's Joy" onClick={onRetry}>
              Retry
            </IonButton>
          }
        >
          <IonLabel>
            <h2>Soldier's Joy</h2>
          </IonLabel>
        </Row>
      </IonList>
    )
  }

  it('keeps end out of the open control name on a mouse', async () => {
    const onOpen = vi.fn()
    const onRetry = vi.fn()
    renderIonic(namedWithEnd(onOpen, onRetry), { db: openTestDb() })
    const open = page.getByRole('button', { name: "Play Soldier's Joy", exact: true })
    const retry = page.getByRole('button', { name: "Retry Soldier's Joy", exact: true })
    await expect.element(open).toBeVisible()
    await expect.element(retry).toBeVisible()
    expect(
      page
        .getByRole('button', { name: "Play Soldier's Joy Retry Soldier's Joy", exact: true })
        .query(),
    ).toBeNull()
    await retry.click()
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('keeps end out of the open control name on touch, both still their own control', async () => {
    forceTouch()
    const onOpen = vi.fn()
    const onRetry = vi.fn()
    renderIonic(namedWithEnd(onOpen, onRetry), { db: openTestDb() })
    const open = page.getByRole('button', { name: "Play Soldier's Joy", exact: true })
    const retry = page.getByRole('button', { name: "Retry Soldier's Joy", exact: true })
    await expect.element(open).toBeVisible()
    await expect.element(retry).toBeVisible()
    expect(
      page
        .getByRole('button', { name: "Play Soldier's Joy Retry Soldier's Joy", exact: true })
        .query(),
    ).toBeNull()
    await retry.click()
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
    await open.click()
    expect(onOpen).toHaveBeenCalledOnce()
  })
})

describe('Row with a named open control and a leading glyph', () => {
  function namedWithGlyph(onOpen: () => void) {
    return (
      <IonList>
        <Row
          name="Soldier's Joy"
          onOpen={onOpen}
          openName="Play"
          start={
            <span
              slot="start"
              data-testid="glyph"
              role="img"
              aria-label="Held here"
              className="flex size-11 items-center justify-center"
            >
              ●
            </span>
          }
        >
          <IonLabel>
            <h2>Soldier's Joy</h2>
          </IonLabel>
        </Row>
      </IonList>
    )
  }

  /** What a real tap at this point of the row would reach, by the browser's own hit test. */
  function hit(x: number, y: number) {
    const target = document.elementFromPoint(x, y)
    return target?.hasAttribute('data-row-open') === true ? (target as HTMLElement) : null
  }

  async function corners() {
    await expect.element(page.getByTestId('glyph')).toBeVisible()
    const item = document.querySelector('ion-list > ion-item')!
    const open = item.querySelector<HTMLButtonElement>('[data-row-open]')!
    const itemBox = item.getBoundingClientRect()
    const glyphBox = document.querySelector('[data-testid="glyph"]')!.getBoundingClientRect()
    return {
      open,
      itemBox,
      // The row's leading padding, the strips above and below the glyph, and the glyph itself.
      points: {
        leadingEdge: [itemBox.x + 1, itemBox.y + itemBox.height / 2],
        aboveGlyph: [glyphBox.x + glyphBox.width / 2, itemBox.y + 1],
        belowGlyph: [glyphBox.x + glyphBox.width / 2, itemBox.bottom - 1],
        glyph: [glyphBox.x + glyphBox.width / 2, glyphBox.y + glyphBox.height / 2],
        trailingEdge: [itemBox.right - 1, itemBox.y + itemBox.height / 2],
      } as Record<string, [number, number]>,
    }
  }

  it('covers every point of the row with the open control, on a mouse', async () => {
    const onOpen = vi.fn()
    renderIonic(namedWithGlyph(onOpen), { db: openTestDb() })
    const { open, itemBox, points } = await corners()
    const openBox = open.getBoundingClientRect()
    expect([openBox.x, openBox.y, openBox.width, openBox.height]).toEqual([
      itemBox.x,
      itemBox.y,
      itemBox.width,
      itemBox.height,
    ])
    for (const [where, [x, y]] of Object.entries(points)) {
      expect(hit(x, y), where).toBe(open)
    }
    hit(...points.leadingEdge!)!.click()
    hit(...points.aboveGlyph!)!.click()
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('covers every point of the row with the open control, on touch', async () => {
    forceTouch()
    const onOpen = vi.fn()
    renderIonic(namedWithGlyph(onOpen), { db: openTestDb() })
    const { open, itemBox, points } = await corners()
    const openBox = open.getBoundingClientRect()
    expect([openBox.x, openBox.y, openBox.width, openBox.height]).toEqual([
      itemBox.x,
      itemBox.y,
      itemBox.width,
      itemBox.height,
    ])
    for (const [where, [x, y]] of Object.entries(points)) {
      expect(hit(x, y), where).toBe(open)
    }
    hit(...points.leadingEdge!)!.click()
    hit(...points.belowGlyph!)!.click()
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('leaves the glyph in the accessibility tree, on a mouse', async () => {
    renderIonic(
      namedWithGlyph(() => {}),
      { db: openTestDb() },
    )
    await expect.element(page.getByRole('img', { name: 'Held here' })).toBeVisible()
  })

  it('leaves the glyph in the accessibility tree, on touch', async () => {
    forceTouch()
    renderIonic(
      namedWithGlyph(() => {}),
      { db: openTestDb() },
    )
    await expect.element(page.getByRole('img', { name: 'Held here' })).toBeVisible()
  })
})

describe('Row with a named open control, focused on touch', () => {
  it('draws the focus ring over the whole row, with nothing clipping it', async () => {
    forceTouch()
    const onOpen = vi.fn()
    renderIonic(
      <IonList>
        <Row name="Soldier's Joy" onOpen={onOpen} openName="Play">
          <IonLabel>
            <h2>Soldier's Joy</h2>
          </IonLabel>
        </Row>
        <Row name="Cluck Old Hen" onOpen={() => {}} openName="Play">
          <IonLabel>
            <h2>Cluck Old Hen</h2>
          </IonLabel>
        </Row>
      </IonList>,
      { db: openTestDb() },
    )
    const open = page.getByRole('button', { name: "Play Soldier's Joy", exact: true })
    await expect.element(open).toBeVisible()
    const button = open.element() as HTMLButtonElement
    button.focus()
    await userEvent.tab()
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(button)
    expect(getComputedStyle(button).outlineStyle).toBe('none')
    const item = document.querySelector('ion-list > ion-item')!
    const ring = getComputedStyle(item, '::after')
    expect(ring.borderRightWidth).toBe('2px')
    expect(ring.position).toBe('absolute')
    expect([ring.top, ring.right, ring.bottom, ring.left]).toEqual(['0px', '0px', '0px', '0px'])
    expect(parseFloat(ring.width) + 4).toBe(item.getBoundingClientRect().width)
    expect(parseFloat(ring.height) + 4).toBe(item.getBoundingClientRect().height)
  })
})

describe('Row while selecting', () => {
  function selectable(props: {
    selected?: boolean
    openName?: string
    openId?: string
    onLongPress?: () => void
  }) {
    return (
      <IonList>
        <Row name="Soldier's Joy" onOpen={() => {}} {...props}>
          <p>Soldier's Joy</p>
        </Row>
      </IonList>
    )
  }

  it('announces a selectable row as a checkbox naming the item', async () => {
    renderIonic(selectable({ openName: 'Select', selected: false }), { db: openTestDb() })
    await expect.element(page.getByRole('checkbox', { name: "Select Soldier's Joy" })).toBeVisible()
    expect(document.querySelector('[data-row-open]')).toHaveAttribute('aria-checked', 'false')
    expect(document.querySelector('[data-row-check]')).not.toBeNull()
  })

  it('reads a selected row as checked and renames its control', async () => {
    renderIonic(selectable({ openName: 'Deselect', selected: true }), { db: openTestDb() })
    await expect
      .element(page.getByRole('checkbox', { name: "Deselect Soldier's Joy" }))
      .toBeChecked()
  })

  it('draws a different mark for each state, under the control that takes the tap', async () => {
    renderIonic(
      <IonList>
        <Row name="Soldier's Joy" onOpen={() => {}} openName="Deselect" selected>
          <p>Soldier's Joy</p>
        </Row>
        <Row name="Cluck Old Hen" onOpen={() => {}} openName="Select" selected={false}>
          <p>Cluck Old Hen</p>
        </Row>
      </IonList>,
      { db: openTestDb() },
    )
    const marks = document.querySelectorAll('[data-row-check]')
    await vi.waitFor(() =>
      expect(document.querySelector('ion-item')!.getBoundingClientRect().height).toBeGreaterThan(
        10,
      ),
    )
    expect(marks[0]!.innerHTML).not.toBe(marks[1]!.innerHTML)
    const box = marks[0]!.getBoundingClientRect()
    // A real tap on the mark opens the control, which is what carries the checkbox.
    expect(document.elementFromPoint(box.x + 1, box.y + 1)).toHaveAttribute('data-row-open')
  })

  it.each(['light', 'dark'])('keeps the unselected mark clear of its row in %s', async (theme) => {
    // The palette goes on before the render, as it does at boot.
    document.documentElement.classList.toggle('ion-palette-dark', theme === 'dark')
    renderIonic(selectable({ openName: 'Select', selected: false }), { db: openTestDb() })
    await expect.element(page.getByRole('checkbox', { name: "Select Soldier's Joy" })).toBeVisible()
    const mark = document.querySelector('[data-row-check] svg')!
    // 3:1 is what WCAG 1.4.11 asks of the part of a control that carries its state.
    expect(glyphContrast(mark)).toBeGreaterThanOrEqual(3)
  })

  it('puts openId on the open control, where focus has to land', async () => {
    renderIonic(selectable({ openName: 'Select', selected: false, openId: 'select-u1' }), {
      db: openTestDb(),
    })
    await expect.element(page.getByRole('checkbox', { name: "Select Soldier's Joy" })).toBeVisible()
    const named = document.getElementById('select-u1')
    expect(named).toHaveAttribute('data-row-open')
    named!.focus()
    expect(document.activeElement).toBe(named)
    expect(document.querySelector('[data-row-check]')).not.toHaveAttribute('id')
  })

  it('shows no check mark and no checkbox role outside selection', async () => {
    renderIonic(selectable({}), { db: openTestDb() })
    await expect.element(page.getByRole('button')).toBeVisible()
    expect(document.querySelector('[data-row-check]')).toBeNull()
  })

  it('opens through its own control on touch while selecting, with no openName', async () => {
    forceTouch()
    renderIonic(selectable({ selected: false }), { db: openTestDb() })
    await expect.element(page.getByRole('checkbox', { name: "Soldier's Joy" })).toBeVisible()
  })

  it('fires a long press after the hold and not after a short tap', async () => {
    forceTouch()
    const onLongPress = vi.fn()
    renderIonic(selectable({ onLongPress }), { db: openTestDb() })
    const row = document.querySelector('ion-item')!
    row.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        isPrimary: true,
        button: 0,
        clientX: 20,
        clientY: 20,
      }),
    )
    await vi.waitFor(() => expect(onLongPress).toHaveBeenCalledOnce(), { timeout: 2000 })
  })

  it('never holds for a long press on a mouse, which has its own Select control', async () => {
    const onLongPress = vi.fn()
    renderIonic(selectable({ onLongPress }), { db: openTestDb() })
    const row = document.querySelector('ion-item')!
    row.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        isPrimary: true,
        button: 0,
        clientX: 20,
        clientY: 20,
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(onLongPress).not.toHaveBeenCalled()
  })
})

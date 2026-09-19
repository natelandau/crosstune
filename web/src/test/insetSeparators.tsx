import { IonItem, IonLabel, IonList, IonReorderGroup } from '@ionic/react'
import { Minus } from 'lucide-react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MOUSE_QUERY } from '../platform/pointer'
import { Row } from '../ui/Row'
import { openTestDb } from './db'
import { renderIonic } from './ionic'

type Kind = 'item' | 'sliding'

const originalMatchMedia = window.matchMedia

/** The width of the line under an item, whether Ionic draws it inset or full. */
function lineUnder(item: Element): number {
  const native = item.shadowRoot?.querySelector('.item-native')
  const inner = item.shadowRoot?.querySelector('.item-inner')
  if (!native || !inner) throw new Error('The item has not rendered')
  return (
    parseFloat(getComputedStyle(native).borderBottomWidth) +
    parseFloat(getComputedStyle(inner).borderBottomWidth)
  )
}

function renderList(kinds: Kind[], lines?: 'none' | 'full', reorderable = false) {
  const rows = kinds.map((kind, index) =>
    kind === 'sliding' ? (
      <Row
        key={index}
        name={`Row ${index}`}
        onOpen={() => {}}
        actions={[{ label: 'Remove', icon: Minus, tone: 'error', onPress: () => {} }]}
      >
        <IonLabel>{`Row ${index}`}</IonLabel>
      </Row>
    ) : (
      <IonItem key={index} button>
        <IonLabel>{`Row ${index}`}</IonLabel>
      </IonItem>
    ),
  )
  const body: ReactNode = reorderable ? (
    <IonReorderGroup disabled={false}>{rows}</IonReorderGroup>
  ) : (
    rows
  )
  renderIonic(
    <IonList inset lines={lines}>
      {body}
    </IonList>,
    { db: openTestDb() },
  )
  const scope = reorderable ? 'ion-list > ion-reorder-group' : 'ion-list'
  return () =>
    Array.from(document.querySelectorAll(`${scope} > ion-item, ${scope} > ion-item-sliding`)).map(
      (row) => (row.tagName === 'ION-ITEM' ? row : row.querySelector('ion-item')!),
    )
}

/**
 * Checks the lines under touch rows in inset lists that mix sliding rows and plain items: a
 * line under every row but the last, by position, and none at all when the list turns lines off.
 */
export function insetSeparatorTests(mode: string) {
  describe(`inset list separators on ${mode}`, () => {
    afterEach(() => {
      window.matchMedia = originalMatchMedia
    })

    const forceTouch = () => {
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

    it.each([
      [['sliding', 'item'] as Kind[]],
      [['item', 'item', 'sliding'] as Kind[]],
      [['sliding', 'item', 'sliding', 'item'] as Kind[]],
    ])('draws a line under every row but the last in %j', async (kinds) => {
      forceTouch()
      const rows = renderList(kinds)
      await vi.waitFor(() => {
        const widths = rows().map(lineUnder)
        expect(
          widths.slice(0, -1).every((width) => width > 0),
          `${widths}`,
        ).toBe(true)
        expect(widths.at(-1)).toBe(0)
      })
    })

    it('draws a line under every row but the last when the list asks for full lines', async () => {
      forceTouch()
      const rows = renderList(['item', 'sliding', 'item'], 'full')
      await vi.waitFor(() => {
        const widths = rows().map(lineUnder)
        expect(
          widths.slice(0, -1).every((width) => width > 0),
          `${widths}`,
        ).toBe(true)
        expect(widths.at(-1)).toBe(0)
      })
    })

    it.each([[['sliding', 'item'] as Kind[]], [['item', 'sliding', 'sliding'] as Kind[]]])(
      'draws the same lines for reorderable rows in %j',
      async (kinds) => {
        forceTouch()
        const rows = renderList(kinds, undefined, true)
        await vi.waitFor(() => {
          const widths = rows().map(lineUnder)
          expect(widths).toHaveLength(kinds.length)
          expect(
            widths.slice(0, -1).every((width) => width > 0),
            `${widths}`,
          ).toBe(true)
          expect(widths.at(-1)).toBe(0)
        })
      },
    )

    it('draws no lines when the list turns them off', async () => {
      forceTouch()
      const rows = renderList(['sliding', 'item', 'sliding', 'item'], 'none')
      // Waits for every item to render before reading a width of zero.
      await vi.waitFor(() => expect(rows().map(lineUnder)).toEqual([0, 0, 0, 0]))
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(rows().map(lineUnder)).toEqual([0, 0, 0, 0])
    })
  })
}

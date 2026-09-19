import { IonItem, IonLabel, IonList } from '@ionic/react'
import { describe, expect, it, vi } from 'vitest'
import { openTestDb } from './db'
import { renderIonic } from './ionic'

const ROLES = [
  'type-title',
  'type-headline',
  'type-body',
  'type-subheadline',
  'type-footnote',
  'type-caption',
]

/**
 * Checks that each type role looks the same inside an ion-label, whose Ionic styles set their
 * own size, weight, and color on headings and paragraphs, as it does outside one.
 */
export function typeRoleTests(mode: string) {
  describe(`type roles on ${mode}`, () => {
    it('keep their size, weight, tracking, and color inside an ion-label', async () => {
      renderIonic(
        <>
          <div data-outside>
            {ROLES.map((role) => (
              <p key={role} className={role}>
                {role}
              </p>
            ))}
          </div>
          <IonList>
            <IonItem>
              <IonLabel>
                <h2 className="type-headline">type-headline</h2>
                {ROLES.filter((role) => role !== 'type-headline').map((role) => (
                  <p key={role} className={role}>
                    {role}
                  </p>
                ))}
              </IonLabel>
            </IonItem>
          </IonList>
        </>,
        { db: openTestDb() },
      )
      const label = document.querySelector('ion-label')!
      // Ionic scopes its label styles once the label hydrates.
      await vi.waitFor(() => expect(label.classList.contains('hydrated')).toBe(true))
      const look = (element: Element) => {
        const style = getComputedStyle(element)
        return [
          style.fontSize,
          style.fontWeight,
          style.lineHeight,
          style.letterSpacing,
          style.color,
        ].join(' ')
      }
      for (const role of ROLES) {
        const outside = document.querySelector(`[data-outside] .${role}`)!
        const inside = label.querySelector(`.${role}`)!
        expect(look(inside), role).toBe(look(outside))
      }
    })

    it('keep their own color inside an ion-label, so a color utility goes on a child span', async () => {
      renderIonic(
        <>
          <span data-probe className="text-(--ion-color-warning)" />
          <IonList>
            <IonItem>
              <IonLabel>
                <p data-on-role className="type-footnote text-(--ion-color-warning)">
                  on the role
                </p>
                <p data-plain className="type-footnote">
                  plain
                </p>
                <p className="type-footnote">
                  <span data-on-span className="text-(--ion-color-warning)">
                    on a span
                  </span>
                </p>
              </IonLabel>
            </IonItem>
          </IonList>
        </>,
        { db: openTestDb() },
      )
      const label = document.querySelector('ion-label')!
      await vi.waitFor(() => expect(label.classList.contains('hydrated')).toBe(true))
      const color = (selector: string) => getComputedStyle(document.querySelector(selector)!).color
      expect(color('[data-probe]')).not.toBe(color('[data-plain]'))
      expect(color('[data-on-role]')).toBe(color('[data-plain]'))
      expect(color('[data-on-span]')).toBe(color('[data-probe]'))
    })

    it('keep tabular numerals set on a role inside an ion-label', async () => {
      renderIonic(
        <IonList>
          <IonItem>
            <IonLabel>
              <p className="type-subheadline tabular-nums">3/4 A</p>
            </IonLabel>
          </IonItem>
        </IonList>,
        { db: openTestDb() },
      )
      const label = document.querySelector('ion-label')!
      await vi.waitFor(() => expect(label.classList.contains('hydrated')).toBe(true))
      const numerals = label.querySelector('p')!
      expect(getComputedStyle(numerals).fontVariantNumeric).toBe('tabular-nums')
    })
  })
}

import { Music } from 'lucide-react'
import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { page } from 'vitest/browser'
import { expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { EmptyState } from './EmptyState'
import { Row } from './Row'
import { RowList } from './RowList'
import { SectionEmpty } from './SectionEmpty'
import { useHadContent } from './useHadContent'

const NOTHING = 'No tunes yet'
const NOTHING_HERE = 'Nothing in this section'

type Set = (titles: string[]) => void

/** A screen's list and the empty state that takes its place, as the app's screens wire them. */
function Screen({ start, onSet }: { start: string[]; onSet: (set: Set) => void }) {
  const [titles, setTitles] = useState(start)
  useEffect(() => onSet(setTitles), [onSet])
  const hadTunes = useHadContent(titles.length > 0)
  const hadNone = useHadContent(titles.length === 0)
  return (
    <>
      {titles.length === 0 ? (
        <EmptyState arriving={hadTunes} icon={Music} title={NOTHING} />
      ) : (
        <RowList label="Tunes" arriving={hadNone}>
          {titles.map((title) => (
            <Row key={title} id={title} textValue={title} title={title} />
          ))}
        </RowList>
      )}
      {titles.length === 0 && (
        <SectionEmpty arriving={hadTunes} icon={Music} title={NOTHING_HERE} />
      )}
    </>
  )
}

async function mounted(start: string[]) {
  let set: Set | null = null
  renderWithProviders(<Screen start={start} onSet={(next) => (set = next)} />, {
    density: 'pointer',
  })
  await expect.poll(() => set).not.toBeNull()
  return (titles: string[]) => flushSync(() => set!(titles))
}

const fading = (element: Element) =>
  element
    .getAnimations()
    .some((animation) => (animation as CSSAnimation).animationName === 'arrive')
const emptyState = () => page.getByRole('heading', { name: NOTHING }).element().parentElement!
const sectionEmpty = () => page.getByText(NOTHING_HERE).element().parentElement!
const list = () => page.getByRole('grid', { name: 'Tunes' }).element()

it('shows an empty state there on load without motion', async () => {
  await mounted([])
  await expect.element(page.getByRole('heading', { name: NOTHING })).toBeVisible()
  expect(fading(emptyState())).toBe(false)
  expect(fading(sectionEmpty())).toBe(false)
})

it('shows a list there on load without motion', async () => {
  await mounted(['Forked Deer'])
  await expect.element(page.getByRole('grid', { name: 'Tunes' })).toBeVisible()
  expect(fading(list())).toBe(false)
})

it('fades the empty state in when the last row goes, and the list back in after', async () => {
  const set = await mounted(['Forked Deer'])
  await expect.element(page.getByRole('grid', { name: 'Tunes' })).toBeVisible()
  set([])
  expect(fading(emptyState())).toBe(true)
  expect(fading(sectionEmpty())).toBe(true)
  set(['Salt Creek'])
  expect(fading(list())).toBe(true)
})

it('fades a list in when its first row arrives after an empty load', async () => {
  const set = await mounted([])
  await expect.element(page.getByRole('heading', { name: NOTHING })).toBeVisible()
  set(['Salt Creek'])
  expect(fading(list())).toBe(true)
})

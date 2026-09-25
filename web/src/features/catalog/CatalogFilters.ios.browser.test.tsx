import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { CatalogFilters } from './CatalogFilters'
import { DEFAULT_FILTERS, facetValues } from './filters'

const facets = facetValues([])

/** No status label is clipped, and the four capsules stay on one line, at phone width. */
async function expectNoStatusLabelOverflow() {
  renderIonic(
    <CatalogFilters filters={DEFAULT_FILTERS} facets={facets} visible={[]} onChange={() => {}} />,
    { db: openTestDb() },
  )
  // Waits for real layout: a freshly hydrated label has zero width and would pass trivially.
  await expect.element(page.getByRole('button', { name: 'Unknown', exact: true })).toBeVisible()
  const group = document.querySelector('[role="group"][aria-label="Status"]') as HTMLElement
  const buttons = [...group.querySelectorAll('button')]
  expect(buttons.length).toBe(4)
  for (const button of buttons) {
    const label = button.firstElementChild as HTMLElement
    expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1)
  }
  // One line, whatever the text size: a capsule past the edge scrolls into reach rather than
  // dropping onto a second row.
  const tops = new Set(buttons.map((button) => button.offsetTop))
  expect(tops.size).toBe(1)
}

describe('CatalogFilters on iOS', () => {
  it('fits every status label on one line at phone width', async () => {
    await expectNoStatusLabelOverflow()
  })

  it('scales the status labels with the roomy text size and still fits them', async () => {
    document.documentElement.dataset.textSize = 'roomy'
    try {
      await expectNoStatusLabelOverflow()
    } finally {
      delete document.documentElement.dataset.textSize
    }
  })
})

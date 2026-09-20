import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { openTestDb } from '../../test/db'
import { renderIonic } from '../../test/ionic'
import { CatalogFilters } from './CatalogFilters'
import { DEFAULT_FILTERS, type FacetValues } from './filters'

const facets: FacetValues = { key: [], mode: [], violin_tuning: [], banjo_tuning: [], genre: [] }

/** No status label, including "Unknown", is clipped at the viewport's phone width. */
async function expectNoStatusLabelOverflow() {
  renderIonic(
    <CatalogFilters filters={DEFAULT_FILTERS} facets={facets} visible={[]} onChange={() => {}} />,
    { db: openTestDb() },
  )
  // Waits for real layout: a freshly hydrated label has zero width and would pass trivially.
  await expect.element(page.getByRole('button', { name: 'Unknown', exact: true })).toBeVisible()
  const group = document.querySelector('[role="group"][aria-label="Status"]') as HTMLElement
  const labels = group.querySelectorAll('button > span')
  expect(labels.length).toBe(4)
  for (const label of labels) {
    expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1)
  }
  // The four capsules wrap rather than run off the edge, whatever the text size.
  expect(group.scrollWidth).toBeLessThanOrEqual(group.clientWidth + 1)
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

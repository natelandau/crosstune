import { useState } from 'react'
import { page, userEvent } from 'vitest/browser'
import { afterAll, expect, it } from 'vitest'
import { renderWithProviders } from '../../test/render'
import { DONE } from '../confirmCopy'
import { NOT_SET } from '../fieldCopy'
import { useAttributeEdit } from './AttributeEditor'
import { AttributesColumn, type AttributeColumnRow } from './AttributesColumn'

afterAll(async () => {
  await page.viewport(390, 844)
})

const GROUPS = [{ id: 'main', heading: 'Main' }]
const WIDE = { width: 1280, height: 800, density: 'pointer' } as const

function renderColumn(
  rows: AttributeColumnRow[],
  sheetFor?: (row: AttributeColumnRow) => boolean,
  layout: 'column' | 'card' = 'column',
) {
  return renderWithProviders(
    <AttributesColumn
      label="Details"
      layout={layout}
      groups={GROUPS}
      rows={rows}
      emptyText={NOT_SET}
      stored={{}}
      onCommit={() => {}}
      editorFor={(row) => <p>{`Editing ${row.label}`}</p>}
      sheetFor={sheetFor}
    />,
    { density: WIDE.density },
  )
}

const LAYOUTS = ['column', 'card'] as const

it.each(LAYOUTS)(
  'renders a read-only row with no button and no disclosure in the %s',
  async (layout) => {
    renderColumn(
      [{ id: 'added', label: 'Added', text: 'Jan 1', group: 'main', readOnly: true }],
      undefined,
      layout,
    )
    await expect.element(page.getByRole('group', { name: 'Added, Jan 1' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: /Added/ })).not.toBeInTheDocument()
  },
)

it.each(LAYOUTS)("renders a row's below content under it in the %s", async (layout) => {
  renderColumn(
    [{ id: 'where', label: 'Location', text: 'Barn', group: 'main', below: <p>map</p> }],
    undefined,
    layout,
  )
  const row = page.getByRole('button', { name: 'Location, Barn' })
  await expect.element(row).toBeVisible()
  await expect.element(page.getByText('map')).toBeVisible()
  const below = page.getByText('map').element()
  expect(
    row.element().compareDocumentPosition(below) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
})

it('opens a forced sheet on a wide frame', async () => {
  await page.viewport(WIDE.width, WIDE.height)
  renderColumn([{ id: 'where', label: 'Location', text: null, group: 'main' }], () => true)
  await page.getByRole('button', { name: 'Location, Not set' }).click()
  await expect.element(page.getByRole('dialog', { name: 'Location' })).toBeVisible()
  // Only the sheet has a Done button; the popover has none.
  await expect.element(page.getByRole('button', { name: DONE })).toBeVisible()
})

it('opens a popover on a wide frame when no sheet is asked for', async () => {
  await page.viewport(WIDE.width, WIDE.height)
  renderColumn([{ id: 'where', label: 'Location', text: null, group: 'main' }])
  await page.getByRole('button', { name: 'Location, Not set' }).click()
  await expect.element(page.getByRole('dialog', { name: 'Location' })).toBeVisible()
  await expect.element(page.getByRole('button', { name: DONE })).not.toBeInTheDocument()
})

it('shows the empty text for a row with no value', async () => {
  renderColumn([{ id: 'where', label: 'Location', text: null, group: 'main' }])
  await expect.element(page.getByText(NOT_SET)).toBeVisible()
})

it('leaves out the heading of a group that has none, keeping the others', async () => {
  renderWithProviders(
    <AttributesColumn
      label="Details"
      layout="column"
      groups={[{ id: 'main', heading: 'Main' }, { id: 'notes' }]}
      rows={[
        { id: 'name', label: 'Name', text: 'Reel', group: 'main' },
        { id: 'notes', label: 'Notes', text: null, group: 'notes' },
      ]}
      emptyText={NOT_SET}
      stored={{}}
      onCommit={() => {}}
      editorFor={() => null}
    />,
    { density: WIDE.density },
  )
  await expect.element(page.getByRole('button', { name: 'Notes, Not set' })).toBeVisible()
  expect(
    page
      .getByRole('heading')
      .elements()
      .map((heading) => heading.textContent),
  ).toEqual(['Main'])
})

/** Saves at once, so the row's group is the one that last saved. */
function SaveBody() {
  const edit = useAttributeEdit<{ value: number }>()
  return (
    <button type="button" onClick={() => edit.done({ value: 1 })}>
      Save now
    </button>
  )
}

/** A card of two groups whose every save is refused. */
function RefusingCard() {
  const [error, setError] = useState<string | null>(null)
  return (
    <AttributesColumn
      label="Details"
      layout="card"
      groups={[
        { id: 'first', heading: 'First' },
        { id: 'second', heading: 'Second' },
      ]}
      rows={[
        { id: 'a', label: 'Alpha', text: null, group: 'first' },
        { id: 'b', label: 'Beta', text: null, group: 'second' },
      ]}
      emptyText={NOT_SET}
      stored={{ value: 0 }}
      onCommit={() => setError('Refused')}
      editorFor={() => <SaveBody />}
      error={error}
    />
  )
}

it('shows a refusal in the card of the row that saved, with nothing folded', async () => {
  await page.viewport(WIDE.width, WIDE.height)
  renderWithProviders(<RefusingCard />, { density: WIDE.density })
  await page.getByRole('button', { name: 'Beta, Not set' }).click()
  await userEvent.click(page.getByRole('button', { name: 'Save now' }))
  const alert = page.getByText('Refused')
  await expect.element(alert).toBeVisible()
  const beta = page.getByRole('button', { name: 'Beta, Not set' }).element()
  const alpha = page.getByRole('button', { name: 'Alpha, Not set' }).element()
  expect(beta.closest('section')?.contains(alert.element())).toBe(true)
  expect(alpha.closest('section')?.contains(alert.element())).toBe(false)
})

/** A card whose Beta row opens an editor of its own, which the page also opens from outside. */
function OwnEditorCard() {
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  return (
    <>
      <button onClick={() => setOpenId('b')}>Open Beta</button>
      <AttributesColumn
        label="Details"
        layout="card"
        groups={[
          { id: 'first', heading: 'First' },
          { id: 'second', heading: 'Second' },
        ]}
        rows={[
          { id: 'a', label: 'Alpha', text: null, group: 'first' },
          {
            id: 'b',
            label: 'Beta',
            text: null,
            group: 'second',
            ownEditor: ({ onClose, onWrite }) => (
              <button
                onClick={() => {
                  onWrite()
                  setError('Refused')
                  onClose()
                }}
              >
                Write now
              </button>
            ),
          },
        ]}
        emptyText={NOT_SET}
        stored={{ value: 0 }}
        onCommit={() => {}}
        editorFor={() => <SaveBody />}
        error={error}
        openId={openId}
        onOpenIdChange={setOpenId}
      />
    </>
  )
}

it("shows a refusal from a row's own editor in that row's card", async () => {
  await page.viewport(WIDE.width, WIDE.height)
  renderWithProviders(<OwnEditorCard />, { density: WIDE.density })
  await page.getByRole('button', { name: 'Beta, Not set' }).click()
  await page.getByRole('button', { name: 'Write now' }).click()
  const alert = page.getByText('Refused')
  await expect.element(alert).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Write now' })).not.toBeInTheDocument()
  const beta = page.getByRole('button', { name: 'Beta, Not set' }).element()
  expect(beta.closest('section')?.contains(alert.element())).toBe(true)
})

it("opens a row's editor from outside the column", async () => {
  await page.viewport(WIDE.width, WIDE.height)
  renderWithProviders(<OwnEditorCard />, { density: WIDE.density })
  await page.getByRole('button', { name: 'Open Beta' }).click()
  await expect.element(page.getByRole('button', { name: 'Write now' })).toBeVisible()
})

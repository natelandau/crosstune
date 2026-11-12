import { useState } from 'react'
import { page, userEvent } from 'vitest/browser'
import { afterAll, expect, it } from 'vitest'
import { renderWithProviders } from '../../test/render'
import { holdMotionClock, motionFrames } from '../../test/motionClock'
import { DONE } from '../confirmCopy'
import { NOT_SET } from '../fieldCopy'
import { Sheet } from '../Sheet'
import { SHEET } from '../sheetGeometry'
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
            ownEditor: ({ isOpen, onClose, onClosed, onWrite }) => (
              <Sheet
                isOpen={isOpen}
                onOpenChange={(open) => {
                  if (!open) onClose()
                }}
                onClosed={onClosed}
                title="Beta"
                cancel={null}
              >
                <button
                  onClick={() => {
                    onWrite()
                    setError('Refused')
                    onClose()
                  }}
                >
                  Write now
                </button>
              </Sheet>
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

/** A column with a row whose built-in editor is a sheet, and a row whose own editor is one. */
function SheetEditorsColumn() {
  return (
    <AttributesColumn
      label="Details"
      layout="column"
      groups={GROUPS}
      rows={[
        { id: 'name', label: 'Name', text: null, group: 'main' },
        {
          id: 'place',
          label: 'Place',
          text: null,
          group: 'main',
          ownEditor: ({ isOpen, onClose, onClosed }) => (
            <Sheet
              isOpen={isOpen}
              onOpenChange={(open) => {
                if (!open) onClose()
              }}
              onClosed={onClosed}
              title="Place"
              cancel={null}
              primary={{ label: DONE, onPress: onClose }}
            >
              <p>Editing Place</p>
            </Sheet>
          ),
        },
      ]}
      emptyText={NOT_SET}
      stored={{}}
      onCommit={() => {}}
      editorFor={(row) => <p>{`Editing ${row.label}`}</p>}
      sheetFor={() => true}
    />
  )
}

it.each([
  ['built-in', 'Name'],
  ['own', 'Place'],
])(
  'slides a %s editor sheet up from the window foot and back down on Done on touch',
  async (_, label) => {
    await page.viewport(390, 844)
    holdMotionClock()
    renderWithProviders(<SheetEditorsColumn />, { density: 'touch' })
    await page.getByRole('button', { name: `${label}, ${NOT_SET}` }).click()
    const sheet = page.getByRole('dialog', { name: label })
    await expect.element(sheet).toBeInTheDocument()
    const top = () => sheet.element().getBoundingClientRect().top
    const partTop = window.innerHeight * (1 - SHEET.partRatio)
    await expect.poll(top).toBeGreaterThanOrEqual(window.innerHeight - 1)
    motionFrames(1000)
    await expect.poll(top).toBe(partTop)
    await sheet.getByRole('button', { name: DONE }).click()
    motionFrames(50)
    // Still in the page partway down, rather than removed the moment it closed.
    expect(sheet.query()).not.toBeNull()
    expect(top()).toBeGreaterThan(partTop)
    expect(top()).toBeLessThan(window.innerHeight)
    motionFrames(1000)
    await expect.element(sheet).not.toBeInTheDocument()
  },
)

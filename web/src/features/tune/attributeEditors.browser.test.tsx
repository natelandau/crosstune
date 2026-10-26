import { useRef, useState } from 'react'
import { page, userEvent } from 'vitest/browser'
import { afterAll, expect, it, vi } from 'vitest'
import { createTune } from '../../commands/tunes'
import { STATUS_LABELS } from '../../constants'
import { capoLabel, tuningLabel } from '../../domain/instruments'
import { openTestDb } from '../../test/db'
import { dataProviders } from '../../test/providers'
import { renderWithProviders } from '../../test/render'
import { spokenKey } from '../../ui/keyName'
import { DAY_LABEL, MONTH_LABEL, MONTH_LABELS, YEAR_LABEL } from '../../ui/partialDate'
import { DETAIL_LABELS, PART_MODE_LABELS } from './detailFields'
import { AttributeEditor } from './AttributeEditor'
import type { AttributeId } from './attributeRows'
import { AttributeEditorBody } from './attributeEditors'
import { LEARNED_ON_INCOMPLETE, valuesFromRows } from './tuneFormValues'
import { useAttributeWrite, type AttributePatch } from './useAttributeWrite'
import { useTune } from './useTune'

const LABEL = 'Edit attribute'

afterAll(async () => {
  await page.viewport(390, 844)
})

function Harness({
  tuneId,
  id,
  onCommit,
}: {
  tuneId: string
  id: AttributeId
  onCommit: (patch: AttributePatch) => void
}) {
  const view = useTune(tuneId)
  const write = useAttributeWrite(tuneId)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  if (!view) return null
  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <AttributeEditor
        label={LABEL}
        triggerRef={trigger}
        isOpen={open}
        onOpenChange={setOpen}
        stored={valuesFromRows(view.tune, view.userTune)}
        gone={false}
        onCommit={(patch) => {
          onCommit(patch)
          write.write(patch)
        }}
      >
        <AttributeEditorBody id={id} view={view} write={write} />
      </AttributeEditor>
    </>
  )
}

async function open(
  id: AttributeId,
  tune: Parameters<typeof createTune>[1] = { title: 'Reel' },
  status: 'known' | 'learning' | 'want_to_learn' = 'learning',
) {
  await page.viewport(1280, 800)
  const db = openTestDb()
  const { tuneId } = await createTune(db, tune, { status })
  const Data = dataProviders({ db })
  const onCommit = vi.fn<(patch: AttributePatch) => void>()
  renderWithProviders(
    <Data>
      <Harness tuneId={tuneId} id={id} onCommit={onCommit} />
    </Data>,
    { density: 'pointer' },
  )
  await page.getByRole('button', { name: 'Open' }).click()
  await expect.element(page.getByRole('dialog', { name: LABEL })).toBeVisible()
  return { db, tuneId, onCommit }
}

const dismiss = () =>
  userEvent.click(page.elementLocator(document.body), { position: { x: 1200, y: 700 } })
const closed = () =>
  expect.element(page.getByRole('dialog', { name: LABEL })).not.toBeInTheDocument()

it('saves a status pick and closes', async () => {
  const { db, tuneId } = await open('status')
  await page.getByRole('radio', { name: STATUS_LABELS.known }).click()
  await closed()
  await expect
    .poll(async () => (await db.user_tunes.where('tune_id').equals(tuneId).first())?.status)
    .toBe('known')
})

it('saves a key pick and keeps modes reachable', async () => {
  const { db, tuneId } = await open('key')
  await page.getByRole('option', { name: spokenKey('D') }).click()
  await expect.poll(async () => (await db.tunes.get(tuneId))?.key).toBe('D')
  await page.getByRole('button', { name: new RegExp(`${PART_MODE_LABELS[0]}$`) }).click()
  await page.getByRole('option', { name: 'mixolydian' }).click()
  await expect.poll(async () => (await db.tunes.get(tuneId))?.modes).toEqual(['mixolydian'])
  expect((await db.tunes.get(tuneId))?.key).toBe('D')
})

it('clears the key when the chosen one is pressed', async () => {
  const { db, tuneId } = await open('key', { title: 'Reel', key: 'D' })
  await page.getByRole('option', { name: spokenKey('D') }).click()
  await expect.poll(async () => (await db.tunes.get(tuneId))?.key).toBeNull()
})

it('shows a capo only for a fretted instrument', async () => {
  await open('tuning:violin')
  await expect.element(page.getByRole('combobox', { name: tuningLabel('violin') })).toBeVisible()
  expect(
    page.getByRole('button', { name: new RegExp(capoLabel('violin')) }).elements(),
  ).toHaveLength(0)
})

it('offers a capo for a guitar', async () => {
  await open('tuning:guitar')
  await expect
    .element(page.getByRole('button', { name: new RegExp(capoLabel('guitar')) }))
    .toBeVisible()
})

const tuningOf = async (
  db: Awaited<ReturnType<typeof open>>['db'],
  tuneId: string,
  instrument: string,
) =>
  ((await db.tunes.get(tuneId))?.tunings as Record<string, { tuning?: string; capo?: number }>)[
    instrument
  ]

it('saves a violin tuning pick and closes', async () => {
  const { db, tuneId } = await open('tuning:violin')
  await page.getByRole('combobox', { name: tuningLabel('violin') }).fill('Cross')
  await page.getByRole('option', { name: 'Cross A (AEAE)' }).click()
  await closed()
  await expect
    .poll(() => tuningOf(db, tuneId, 'violin'))
    .toMatchObject({ tuning: 'Cross A (AEAE)' })
})

it('saves a guitar tuning pick and stays open for its capo', async () => {
  const { db, tuneId } = await open('tuning:guitar')
  await page.getByRole('combobox', { name: tuningLabel('guitar') }).fill('DADG')
  await page.getByRole('option', { name: 'DADGAD' }).click()
  await expect.poll(() => tuningOf(db, tuneId, 'guitar')).toMatchObject({ tuning: 'DADGAD' })
  // The capo is still there to set, in the same editor.
  await page.getByRole('button', { name: new RegExp(capoLabel('guitar')) }).click()
  await page.getByRole('option', { name: '2', exact: true }).click()
  await dismiss()
  await closed()
  await expect
    .poll(() => tuningOf(db, tuneId, 'guitar'))
    .toMatchObject({ tuning: 'DADGAD', capo: 2 })
})

it('keeps the editor open on Enter with a half-filled learned-on date, saying why', async () => {
  const { onCommit } = await open('learned_on')
  await page.getByRole('textbox', { name: YEAR_LABEL }).fill('2019')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('alert')).toHaveTextContent(LEARNED_ON_INCOMPLETE)
  await expect.element(page.getByRole('dialog', { name: LABEL })).toBeVisible()
  expect(onCommit).not.toHaveBeenCalled()
})

it('saves a whole learned-on date on Enter and closes', async () => {
  const { db, tuneId } = await open('learned_on')
  await page.getByRole('textbox', { name: YEAR_LABEL }).fill('2019')
  await page.getByRole('button', { name: new RegExp(`${MONTH_LABEL}$`) }).click()
  await page.getByRole('option', { name: MONTH_LABELS[2] }).click()
  await page.getByRole('button', { name: new RegExp(`${DAY_LABEL}$`) }).click()
  await page.getByRole('option', { name: '14', exact: true }).click()
  await page.getByRole('textbox', { name: YEAR_LABEL }).click()
  await userEvent.keyboard('{Enter}')
  await closed()
  await expect
    .poll(async () => (await db.user_tunes.where('tune_id').equals(tuneId).first())?.learned_on)
    .toBe('2019-03-14')
})

it('does not save an incomplete learned-on date', async () => {
  const { db, tuneId, onCommit } = await open('learned_on')
  await page.getByRole('textbox', { name: YEAR_LABEL }).fill('2019')
  // The surface's own padding, which leaves the date without dismissing the editor. Tab cannot:
  // the editor holds focus, and the date is all it holds.
  await page.getByRole('dialog', { name: LABEL }).click({ position: { x: 4, y: 4 } })
  await expect.element(page.getByRole('alert')).toHaveTextContent(LEARNED_ON_INCOMPLETE)
  expect(page.getByRole('button', { name: new RegExp(`${MONTH_LABEL}$`) }).elements()).toHaveLength(
    1,
  )
  expect(page.getByRole('button', { name: new RegExp(`${DAY_LABEL}$`) }).elements()).toHaveLength(1)
  await dismiss()
  await closed()
  // The close decides whether to save as it closes, so nothing can still be on its way.
  expect(onCommit).not.toHaveBeenCalled()
  const userTune = await db.user_tunes.where('tune_id').equals(tuneId).first()
  expect(userTune?.learned_on).toBeNull()
})

const tuneRow = async (db: Awaited<ReturnType<typeof open>>['db'], tuneId: string) =>
  db.tunes.get(tuneId)

it.each([
  ['tune_type', () => page.getByRole('combobox', { name: DETAIL_LABELS.tune_type })],
  ['alternate_titles', () => page.getByRole('textbox', { name: DETAIL_LABELS.alternate_titles })],
  ['tuning:violin', () => page.getByRole('combobox', { name: tuningLabel('violin') })],
  ['learned_on', () => page.getByRole('textbox', { name: YEAR_LABEL })],
  ['key', () => page.getByRole('option', { name: spokenKey('A'), exact: true })],
  ['status', () => page.getByRole('radio', { name: STATUS_LABELS.learning })],
  [
    'time_signature',
    () => page.getByRole('button', { name: new RegExp(DETAIL_LABELS.time_signature) }),
  ],
] as const)('opens %s with its first field focused', async (id, first) => {
  await open(id)
  await expect.element(first()).toHaveFocus()
})

it('saves typed text on Enter and closes', async () => {
  const { db, tuneId } = await open('composer')
  await expect.element(page.getByRole('combobox', { name: DETAIL_LABELS.composer })).toHaveFocus()
  await userEvent.keyboard('Kenny Baker')
  await userEvent.keyboard('{Enter}')
  await closed()
  await expect.poll(async () => (await tuneRow(db, tuneId))?.composer).toBe('Kenny Baker')
})

it('saves the also known as titles on Enter', async () => {
  const { db, tuneId } = await open('alternate_titles')
  await page
    .getByRole('textbox', { name: DETAIL_LABELS.alternate_titles })
    .fill('Hop High, Big Sciota')
  await userEvent.keyboard('{Enter}')
  await closed()
  await expect
    .poll(async () => (await tuneRow(db, tuneId))?.alternate_titles)
    .toEqual(['Hop High', 'Big Sciota'])
})

it('saves a suggestion picked with the pointer and closes', async () => {
  const { db, tuneId } = await open('tune_type')
  await page.getByRole('combobox', { name: DETAIL_LABELS.tune_type }).fill('Ji')
  const jig = page.getByRole('option', { name: 'Jig', exact: true })
  await expect.element(jig).toBeVisible()
  await jig.click()
  await closed()
  await expect.poll(async () => (await tuneRow(db, tuneId))?.tune_type).toBe('Jig')
  await expect.poll(async () => (await tuneRow(db, tuneId))?.time_signature).toBe('6/8')
})

it('saves a suggestion picked from the keyboard and closes', async () => {
  const { db, tuneId } = await open('genre')
  await userEvent.keyboard('Blueg')
  await expect.element(page.getByRole('option', { name: 'Bluegrass' })).toBeVisible()
  await userEvent.keyboard('{ArrowDown}{Enter}')
  await closed()
  await expect.poll(async () => (await tuneRow(db, tuneId))?.genre).toBe('Bluegrass')
})

it('turns crooked on from the parts editor at once', async () => {
  const { db, tuneId } = await open('part_structure')
  await page.getByRole('dialog', { name: LABEL }).getByText(DETAIL_LABELS.is_crooked).click()
  await expect.element(page.getByRole('switch', { name: DETAIL_LABELS.is_crooked })).toBeChecked()
  await expect.poll(async () => (await tuneRow(db, tuneId))?.is_crooked).toBe(true)
  await expect.element(page.getByRole('dialog', { name: LABEL })).toBeVisible()
  await page.getByRole('combobox', { name: DETAIL_LABELS.part_structure }).fill('AABB')
  await userEvent.keyboard('{Enter}')
  await closed()
  await expect.poll(async () => (await tuneRow(db, tuneId))?.part_structure).toBe('AABB')
  expect((await tuneRow(db, tuneId))?.is_crooked).toBe(true)
})

it('closes on a press of the status already chosen, writing nothing', async () => {
  const { onCommit } = await open('status')
  await page.getByRole('radio', { name: STATUS_LABELS.learning }).click()
  await closed()
  expect(onCommit).not.toHaveBeenCalled()
})

it('saves a time signature pick and closes', async () => {
  const { db, tuneId } = await open('time_signature')
  await page
    .getByRole('dialog', { name: LABEL })
    .getByRole('button', { name: new RegExp(`${DETAIL_LABELS.time_signature}$`) })
    .click()
  await page.getByRole('option', { name: '3/4' }).click()
  await closed()
  await expect.poll(async () => (await tuneRow(db, tuneId))?.time_signature).toBe('3/4')
})

it('saves learned from on dismiss', async () => {
  const { db, tuneId } = await open('learned_from')
  await userEvent.keyboard('Uncle Dave')
  await expect
    .element(page.getByRole('combobox', { name: DETAIL_LABELS.learned_from }))
    .toHaveValue('Uncle Dave')
  await dismiss()
  await closed()
  await expect
    .poll(async () => (await db.user_tunes.where('tune_id').equals(tuneId).first())?.learned_from)
    .toBe('Uncle Dave')
})

it('turns crooked off from its own row at once', async () => {
  const { db, tuneId } = await open('is_crooked', { title: 'Reel', is_crooked: true })
  await page.getByRole('dialog', { name: LABEL }).getByText(DETAIL_LABELS.is_crooked).click()
  await expect.poll(async () => (await tuneRow(db, tuneId))?.is_crooked).toBe(false)
})

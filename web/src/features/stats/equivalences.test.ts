import { expect, test } from 'vitest'
import { EQUIVALENCES, equivalenceText } from './equivalences'

test('every equivalence has its text', () => {
  for (const { id } of EQUIVALENCES) {
    expect(equivalenceText({ id, n: 2 }, 'Sally Ann')).toMatch(/^About 2 /)
  }
})

test.each([
  [{ id: 'tune', n: 140, tune_id: 't1' }, "About 140 times through Soldier's Joy"],
  [{ id: 'tune', n: 1, tune_id: 't1' }, "About 1 time through Soldier's Joy"],
  [{ id: 'lp_side', n: 3 }, 'About 3 sides of an LP'],
  [{ id: 'lp_side', n: 1 }, 'About 1 side of an LP'],
  [{ id: 'boston_dublin', n: 1_200 }, 'About 1,200 flights from Boston to Dublin'],
  [{ id: 'work_week', n: 2 }, 'About 2 working weeks'],
  [{ id: 'cross_country', n: 1 }, 'About 1 drive from New York to Los Angeles'],
])('equivalenceText(%o)', (eq, text) => {
  expect(equivalenceText(eq, "Soldier's Joy")).toBe(text)
})

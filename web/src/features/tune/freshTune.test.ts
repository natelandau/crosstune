import { afterEach, expect, it } from 'vitest'
import { clearFresh, markFresh, takeFresh } from './freshTune'

afterEach(clearFresh)

it('hands back a mark once, then forgets it', () => {
  markFresh('t1', 3)
  expect(takeFresh('t1')).toBe(3)
  expect(takeFresh('t1')).toBeNull()
})

it('replaces an older mark, whose toast is already gone', () => {
  markFresh('t1', 3)
  markFresh('t2', 4)
  expect(takeFresh('t1')).toBeNull()
  expect(takeFresh('t2')).toBe(4)
})

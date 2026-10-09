import { describe, expect, test } from 'vitest'
import cases from '../../../../fixtures/import/plain-list.json'
import { readPlainList } from './plainList'

describe('readPlainList', () => {
  // The Swift client reads the same file, so both clients read every list the same way.
  test.each(cases)('$name', (c) => {
    const read = readPlainList(c.input)
    expect({ titles: read.candidates.map((x) => x.title), lineCount: read.lineCount }).toEqual({
      titles: c.titles,
      lineCount: c.lineCount,
    })
  })

  test('medley parts share their source line', () => {
    const { candidates } = readPlainList("Silver Spear / Mason's Apron")
    expect(candidates.map((x) => x.source)).toEqual([
      "Silver Spear / Mason's Apron",
      "Silver Spear / Mason's Apron",
    ])
  })
})

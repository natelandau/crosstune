import { expect, it } from 'vitest'
import { isRowTarget } from './keyTarget'

function inside(html: string): Element {
  const host = document.createElement('div')
  host.innerHTML = html
  return host.querySelector('#target')!
}

it.each([
  ['a row', '<div role="row"><span id="target"></span></div>'],
  ['a grid cell', '<div role="gridcell"><button id="target"></button></div>'],
])('is true inside %s', (_, html) => {
  expect(isRowTarget(inside(html))).toBe(true)
})

it.each(['row', 'gridcell'])('is true on the %s itself', (role) => {
  expect(isRowTarget(inside(`<div role="${role}" id="target"></div>`))).toBe(true)
})

it('is false outside a row', () => {
  expect(isRowTarget(inside('<main><button id="target"></button></main>'))).toBe(false)
  expect(isRowTarget(null)).toBe(false)
})

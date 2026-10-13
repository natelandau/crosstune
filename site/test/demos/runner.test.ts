// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { Demo } from '../../src/demos/runner'
import type { DemoDef } from '../../src/demos/types'

const def: DemoDef = {
  label: 'A test demo',
  kind: 'feat',
  h: 500,
  hm: 500,
  markup: () => '<div class="screen"></div>',
  script: async () => {},
}

let stage: HTMLElement

beforeEach(() => {
  document.body.innerHTML = '<div class="cam"><div class="stage"></div></div>'
  stage = document.querySelector('.stage')!
  Object.defineProperty(stage, 'offsetWidth', { value: 1000 })
  Object.defineProperty(stage, 'offsetHeight', { value: 500 })
})

describe('Demo', () => {
  it('rests the pointer near the bottom right of the first frame', () => {
    const demo = new Demo(stage, def, false)
    demo.reset()
    expect(stage.querySelector('.screen')).not.toBeNull()
    expect(demo.cursor?.style.transform).toBe('translate(620px, 460px)')
  })

  it('nudges the pointer from where it is', () => {
    const demo = new Demo(stage, def, false)
    demo.reset()
    demo.nudge(10, -20)
    demo.nudge(-30, 5)
    expect(demo.cursor?.style.transform).toBe('translate(600px, 445px)')
  })

  it('draws no pointer under reduced motion', () => {
    const demo = new Demo(stage, def, true)
    demo.reset()
    demo.nudge(10, 10)
    expect(demo.cursor).toBeNull()
    expect(stage.querySelector('.cursor')).toBeNull()
  })

  it('leaves the first frame without a pointer when stopped', () => {
    const demo = new Demo(stage, def, false)
    demo.reset()
    stage.insertAdjacentHTML('beforeend', '<p class="later"></p>')
    demo.stop()
    expect(demo.cursor).toBeNull()
    expect(stage.innerHTML).toBe(def.markup())
  })
})

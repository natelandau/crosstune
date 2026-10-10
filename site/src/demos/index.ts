import { folk } from './folk'
import { hero } from './hero'
import { listen } from './listen'
import { lists } from './lists'
import { platforms } from './platforms'
import { practice } from './practice'
import { record } from './record'
import { tunePage } from './tunePage'
import { tunes } from './tunes'
import type { DemoDef, DemoName } from './types'

export type { DemoDef, DemoName } from './types'

export const DEMOS: Record<DemoName, DemoDef> = {
  hero,
  tunes,
  tunePage,
  record,
  practice,
  lists,
  listen,
  folk,
  platforms,
}

export const isDemoName = (name: string): name is DemoName => Object.hasOwn(DEMOS, name)

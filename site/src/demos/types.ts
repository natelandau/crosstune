import type { CamKind } from './camera'
import type { Demo } from './runner'

export type DemoName =
  'hero' | 'tunes' | 'tunePage' | 'record' | 'practice' | 'lists' | 'listen' | 'folk' | 'platforms'

export type DemoDef = {
  /** Which scale formula the camera uses. */
  kind: CamKind
  /** Stage height in native pixels on desktop and on mobile. */
  h: number
  hm: number
  /** Composition width centered on desktop, for the hero and the platforms shot. */
  cw?: number
  /** What the demo shows, as its image's accessible name. */
  label: string
  /** The first frame. */
  markup: () => string
  /** What happens, from the first frame. A demo without one is a still. */
  script?: (d: Demo) => Promise<void>
}

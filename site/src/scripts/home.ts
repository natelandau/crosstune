// The home page's one script: the demos.
import { mountDemos } from './demos'
import { followReducedMotion } from './reducedMotion'

followReducedMotion(matchMedia('(prefers-reduced-motion: reduce)'), (reducedMotion) =>
  mountDemos(document, { reducedMotion }),
)

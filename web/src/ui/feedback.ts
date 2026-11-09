/** Short motion that confirms or refuses an action. Each skips movement under reduced motion. */

import { isStampedTouch } from '../platform/density'
import { tap } from '../platform/haptics'
import { matches } from '../platform/mediaQuery'
import { REDUCE_MOTION_QUERY } from '../platform/motion'
import { DURATION, EASE_POP_CSS } from '../theme/motion'

const SHAKE_ID = 'feedback-shake'

function reducedMotion(): boolean {
  return matches(REDUCE_MOTION_QUERY)
}

/** A quick sideways shake, ignored while one already runs on the element. */
export function shake(el: Element): void {
  if (reducedMotion()) return
  if (el.getAnimations().some((a) => a.id === SHAKE_ID)) return
  const animation = el.animate(
    {
      translate: ['0', '-4px 0', '4px 0', '-3px 0', '2px 0', '0'],
    },
    { duration: DURATION.base * 1000, easing: 'ease-out' },
  )
  animation.id = SHAKE_ID
}

/** A spring pop for a state that just turned on, on the `--ease-pop` curve. */
export function pop(el: Element): void {
  if (reducedMotion()) return
  el.animate({ scale: [1, 1.25, 1] }, { duration: DURATION.long * 1000, easing: EASE_POP_CSS })
}

/** A brief swell for a value that snapped into place. */
export function snapPulse(el: Element): void {
  if (reducedMotion()) return
  el.animate({ scale: [1, 1.45, 1] }, { duration: DURATION.short * 1000 })
}

/** A light tap on touch devices that can vibrate. */
export function haptic(): void {
  if (isStampedTouch()) tap(8)
}

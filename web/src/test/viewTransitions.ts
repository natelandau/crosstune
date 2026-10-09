/**
 * Whether no view transition is still animating. A viewport change while one runs aborts it,
 * and the browser reports the abort as an unhandled rejection.
 */
export const viewTransitionsDone = () =>
  !document
    .getAnimations()
    .some((animation) =>
      (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith('::view-transition'),
    )

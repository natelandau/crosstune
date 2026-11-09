import type { Ref } from 'react'
import { useObjectRef } from 'react-aria'
import { shake } from './feedback'
import { useBusyAttribute, useWorking, type TrackWork, type WorkingState } from './useWorking'
import { FADE } from './WorkingMark'

// Fades a control's own content out while the spinner or check covers it.
const COVERED_FADE: Record<WorkingState, string> = {
  idle: `opacity-100 ${FADE}`,
  working: `opacity-0 ${FADE}`,
  done: `opacity-0 ${FADE}`,
}

/** Whether an `aria-disabled` prop turns a control off. */
export function isAriaDisabled(value: boolean | 'true' | 'false' | undefined): boolean {
  return value === true || value === 'true'
}

/**
 * The working timeline for a button that runs `onPress`: the element ref, which shakes when the
 * work fails and carries `aria-busy` while the spinner or check covers it, the state, the press,
 * and the classes that fade the button's own content.
 */
export function useWorkingControl(
  onPress: ((track: TrackWork) => void | Promise<unknown>) | undefined,
  {
    showDone,
    onFailed,
    ref,
  }: { showDone: boolean; onFailed?: (error: unknown) => void; ref?: Ref<HTMLButtonElement> },
) {
  const element = useObjectRef(ref)
  const { state, press } = useWorking(onPress, {
    showDone,
    onFailed: (error) => {
      if (element.current) shake(element.current)
      onFailed?.(error)
    },
  })
  useBusyAttribute(element, state !== 'idle')
  return { element, state, press, content: COVERED_FADE[state] }
}

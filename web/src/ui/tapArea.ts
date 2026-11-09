/** Touch tap areas: each reaches `--target` on touch with no visual change. */

/** For a control: an invisible ::after centered on it, at least the target in both directions. */
export const TAP_AREA =
  "relative after:absolute after:top-1/2 after:left-1/2 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] in-data-[density=touch]:after:h-[max(100%,var(--target))] in-data-[density=touch]:after:w-[max(100%,var(--target))]"

/**
 * For the input inside a field of the regular height: it fills the field and reaches past its
 * top and bottom to the target, where an ::after on the field would cover the input.
 */
export const FIELD_INPUT_TAP_AREA =
  'self-stretch in-data-[density=touch]:-my-[calc((var(--target)-var(--size-regular))/2)]'

/** For an absolutely placed input centered on its box, such as a scrubber's range. */
export const TAP_HEIGHT = 'in-data-[density=touch]:h-[max(100%,var(--target))]'

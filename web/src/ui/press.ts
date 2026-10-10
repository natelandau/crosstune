/** A control's press and hover, shared by every button that draws its own shape. */

/** Squeezes while pressed and eases its hover changes. */
export const PRESS =
  'cursor-default transition-[scale,translate,box-shadow,background-color,color,opacity] duration-(--dur-short) ease-(--ease) data-[pressed]:scale-[0.96] aria-disabled:data-[pressed]:scale-100'

/** A plain capsule or round control: a wash under the pointer. */
export const WASH_HOVER = 'not-disabled:hover:bg-tint-hover'

/** A control that spans a row: a wash under the pointer, deeper while pressed. */
export const ROW_PRESS =
  'cursor-default transition-colors duration-(--dur-short) ease-(--ease) not-disabled:hover:bg-row-hover data-[pressed]:bg-tint'

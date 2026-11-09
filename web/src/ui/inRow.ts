import { createContext, useContext } from 'react'

export type ControlSize = 'compact' | 'regular' | 'large'

/** True inside a list row, where a control takes the compact size unless told otherwise. */
export const InRow = createContext(false)

export function useControlSize(size?: ControlSize): ControlSize {
  const inRow = useContext(InRow)
  return size ?? (inRow ? 'compact' : 'regular')
}

/** Each control size as height, minimum height, width, square, and twice-the-size minimum width. */
export const SIZE_CLASS: Record<
  ControlSize,
  { h: string; minH: string; w: string; square: string; minW2: string }
> = {
  compact: {
    h: 'h-(--size-compact)',
    minH: 'min-h-(--size-compact)',
    w: 'w-(--size-compact)',
    square: 'size-(--size-compact)',
    minW2: 'min-w-[calc(var(--size-compact)*2)]',
  },
  regular: {
    h: 'h-(--size-regular)',
    minH: 'min-h-(--size-regular)',
    w: 'w-(--size-regular)',
    square: 'size-(--size-regular)',
    minW2: 'min-w-[calc(var(--size-regular)*2)]',
  },
  large: {
    h: 'h-(--size-large)',
    minH: 'min-h-(--size-large)',
    w: 'w-(--size-large)',
    square: 'size-(--size-large)',
    minW2: 'min-w-[calc(var(--size-large)*2)]',
  },
}

import type { ReactNode, Ref } from 'react'
import { ToggleButtonGroup } from 'react-aria-components'
import { SEGMENTED_TRACK } from './segmentedTrack'

/** One of `options`, chosen from a row of segments in a capsule; the segments are `children`. */
export function SegmentedChoice<T extends string>({
  ref,
  label,
  options,
  selected,
  onChange,
  children,
  ...data
}: {
  ref?: Ref<HTMLDivElement>
  label: string
  options: readonly T[]
  selected: T
  onChange: (next: T) => void
  children: ReactNode
} & { [attribute: `data-${string}`]: boolean | undefined }) {
  return (
    <ToggleButtonGroup
      ref={ref}
      {...data}
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[selected]}
      onSelectionChange={(keys) => {
        const next = options.find((option) => keys.has(option))
        if (next) onChange(next)
      }}
      className={SEGMENTED_TRACK}
    >
      {children}
    </ToggleButtonGroup>
  )
}

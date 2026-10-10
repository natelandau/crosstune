import { useRef, type CSSProperties } from 'react'
import { useElementSize } from './useElementSize'

/**
 * A capsule's selection ring, drawn just inside the edge of the positioned element it sits in.
 * With `run`, one segment travels the edge and closes into the ring as it mounts; without, the
 * ring is drawn whole. Measured, since a capsule's width follows its label.
 */
export function TraceRing({ color, run }: { color: string; run: boolean }) {
  const box = useRef<HTMLSpanElement>(null)
  const { width, height } = useElementSize(box)
  const radius = (height - 2) / 2
  const rect = (className: string) => (
    <rect
      className={className}
      x={1}
      y={1}
      width={Math.max(width - 2, 0)}
      height={Math.max(height - 2, 0)}
      rx={radius}
      ry={radius}
      pathLength={100}
    />
  )
  return (
    <span ref={box} aria-hidden className="pointer-events-none absolute inset-0">
      {width > 0 && (
        // A drawn shape rather than an icon: the ring is a stroke the selection animates.
        <svg
          className="trace-ring"
          width={width}
          height={height}
          data-run={run || undefined}
          style={{ '--trace': color } as CSSProperties}
        >
          {rect('trace-track')}
          {rect('trace-lead')}
        </svg>
      )}
    </span>
  )
}

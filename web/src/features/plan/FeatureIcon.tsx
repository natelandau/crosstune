import type { LucideIcon } from 'lucide-react'

/** A feature's icon in a tinted tile, shared by the comparison and the included list. */
export function FeatureIcon({ icon: Icon, size }: { icon: LucideIcon; size: 'small' | 'large' }) {
  return (
    <span
      className={`bg-tint text-secondary grid shrink-0 place-items-center rounded-(--radius-row) ${size === 'small' ? 'size-7' : 'size-8'}`}
      aria-hidden
    >
      <Icon className={size === 'small' ? 'size-4' : 'size-5'} />
    </span>
  )
}

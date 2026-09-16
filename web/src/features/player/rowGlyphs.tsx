import { Play, Square } from 'lucide-react'
import type { ReactNode } from 'react'

/** The playable part of a recording or link row: a slot, then the title block, at the row's touch height. */
export const ROW_CLASS = 'flex min-h-14 min-w-0 flex-1 items-center gap-1 py-2 pl-1 text-left'

/** The slot before a row's title, sized to the row's touch target whatever it holds. */
export function Slot({ children }: { children?: ReactNode }) {
  return <span className="flex size-11 shrink-0 items-center justify-center">{children}</span>
}

/** A solid play triangle, nudged right: centered, it looks off-center against its own leading edge. */
export function PlayGlyph() {
  return <Play aria-hidden="true" fill="currentColor" className="ml-0.5 size-5 shrink-0" />
}

/** A solid stop square. A row can only unload the player, so its loaded state reads as stop, not pause. */
export function StopGlyph() {
  return <Square aria-hidden="true" fill="currentColor" className="size-4 shrink-0" />
}

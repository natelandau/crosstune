import { Check, Plus } from 'lucide-react'
import { useRef } from 'react'
import { GLYPH_BOX } from './rowGlyphs'
import { usePopOnChange } from './usePopOnChange'

/**
 * A picker row's glyph: a + in a ring for a choice a press adds, a check in a filled circle for
 * one already added. A change between them pops on the spring. A row's add glyph is always this,
 * so a change to it is one edit.
 */
export function PickGlyph({ added = false }: { added?: boolean }) {
  const Mark = added ? Check : Plus
  const ref = useRef<HTMLSpanElement>(null)
  usePopOnChange(ref, added)
  return (
    <span
      ref={ref}
      aria-hidden
      className={`box-border inline-flex ${GLYPH_BOX} items-center justify-center rounded-full border-2 transition-colors duration-(--dur-base) ease-(--ease) ${
        added
          ? 'border-accent-fill bg-accent-fill text-on-accent-fill'
          : 'border-accent text-accent'
      }`}
    >
      <Mark className="size-4 in-[html[data-density=pointer]]:size-3" strokeWidth={3} />
    </span>
  )
}

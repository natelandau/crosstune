import { SlidersHorizontal } from 'lucide-react'
import { IconButton } from './IconButton'
import { filtersLabel } from './filterCopy'

/**
 * The bar's Filters control: a glyph alone, named by how many filters are set, with an accent
 * dot at the glyph's corner while any are. The count lives in the name, so the dot is only a
 * sighted cue.
 */
export function FiltersBarButton({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <span className="relative inline-flex">
      <IconButton icon={SlidersHorizontal} label={filtersLabel(count)} onPress={onPress} />
      {count > 0 && (
        <span
          data-set
          aria-hidden
          className="bg-accent pointer-events-none absolute end-2 top-2 size-2 rounded-full"
        />
      )}
    </span>
  )
}

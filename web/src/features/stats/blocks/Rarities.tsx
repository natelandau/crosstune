import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { statsTunePath } from '../../settings/settingsPaths'
import { RARITIES_HEADER, rarityLine } from '../copy'
import type { Rarity } from '../types'
import { PageSection } from '../../tune/PageSection'

/** Each line names the tune that holds the rare value and links to it. */
export function Rarities({
  rarities,
  tuneTitles,
}: {
  rarities: readonly Rarity[]
  tuneTitles: ReadonlyMap<string, string>
}) {
  return (
    <PageSection title={RARITIES_HEADER}>
      <ul className="flex flex-col">
        {rarities.map((rarity) => (
          <li key={`${rarity.attribute}:${rarity.instrument ?? ''}:${rarity.value}`}>
            <Link
              to={statsTunePath(rarity.tune_id)}
              className="flex min-h-(--target) items-center gap-2 py-1"
            >
              <span className="min-w-0 flex-1">
                <span className="t-body block">{rarityLine(rarity)}</span>
                <span className="t-secondary text-ink-2 block">
                  {tuneTitles.get(rarity.tune_id)}
                </span>
              </span>
              <ChevronRight className="text-ink-2 size-4 shrink-0" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </PageSection>
  )
}

import { useRef } from 'react'
import { COUNTS_HEADER, STATS_TITLE } from './copy'
import { useStatsScreen } from './useStatsScreen'
import { destination } from '../../app/destinations'
import { useDestination } from '../../app/useDestination'
import { usePaneTitleLine } from '../../app/ColumnTitle'
import { BackLink, PaneBar } from '../../app/PaneBar'
import { useFixedNow } from '../../ui/useNow'
import { Breakdowns } from './blocks/Breakdown'
import { Counts } from './blocks/Counts'
import { Heatmap } from './blocks/Heatmap'
import { Months } from './blocks/Months'
import { OnThisDay } from './blocks/OnThisDay'
import { Rarities } from './blocks/Rarities'
import { Recorded } from './blocks/Recorded'

const SETTINGS = destination('settings')

/**
 * A look back over the catalog, as a document page. Counts and the recorded total always show;
 * every other block shows only when the catalog holds something for it. A value that is a
 * catalog filter opens the catalog's root with only that filter set.
 */
export function StatsPage({ now }: { now?: Date }) {
  const { root } = useDestination()
  const fixedNow = useFixedNow()
  const { view, filterCatalog, filterError } = useStatsScreen({
    openCatalog: () => root('catalog'),
    now: now ?? fixedNow,
  })
  const titleRef = useRef<HTMLHeadingElement>(null)
  usePaneTitleLine(titleRef)
  const filter = (patch: Parameters<typeof filterCatalog>[0], header: string) => {
    void filterCatalog(patch, header)
  }

  return (
    <>
      <PaneBar
        title={STATS_TITLE}
        leading={<BackLink to={SETTINGS.root} label={SETTINGS.label} />}
      />
      <article className="max-w-page mx-auto w-full px-4 pt-2 pb-12">
        <h1 ref={titleRef} className="t-page-title pb-6 select-text">
          {STATS_TITLE}
        </h1>
        {view && (
          <>
            <Counts
              counts={view.stats.counts}
              onStatus={(status) => filter({ status }, COUNTS_HEADER)}
              error={filterError(COUNTS_HEADER)}
            />
            <Recorded
              recorded={view.stats.recorded}
              equivalence={view.stats.equivalence}
              tuneTitles={view.tuneTitles}
            />
            {view.stats.months.all_time.length > 0 && <Months months={view.stats.months} />}
            {view.stats.heatmap.visible && (
              <Heatmap heatmap={view.stats.heatmap} today={view.today} />
            )}
            {view.stats.on_this_day.length > 0 && (
              <OnThisDay
                lines={view.stats.on_this_day}
                tuneTitles={view.tuneTitles}
                recordingTitles={view.recordingTitles}
              />
            )}
            <Breakdowns
              breakdowns={view.stats.breakdowns}
              onFilter={filter}
              filterError={filterError}
            />
            {view.stats.rarities.length > 0 && (
              <Rarities rarities={view.stats.rarities} tuneTitles={view.tuneTitles} />
            )}
          </>
        )}
      </article>
    </>
  )
}

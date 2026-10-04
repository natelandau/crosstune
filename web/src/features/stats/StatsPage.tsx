import { useIonRouter } from '@ionic/react'
import { useState } from 'react'
import { TABS } from '../../app/tabs'
import { useOpenTabRoot } from '../../app/useOpenTabRoot'
import { useDb } from '../../db/DbProvider'
import { Screen } from '../../ui/Screen'
import { DEFAULT_FILTERS, type CatalogFilters } from '../catalog/filters'
import { writeSearchQuery } from '../catalog/searchSession'
import { useCatalogFilters } from '../catalog/useCatalogFilters'
import { BreakdownsBlock } from './blocks/BreakdownsBlock'
import { CountsBlock } from './blocks/CountsBlock'
import { HeatmapBlock } from './blocks/HeatmapBlock'
import { MonthsBlock } from './blocks/MonthsBlock'
import { OnThisDayBlock } from './blocks/OnThisDayBlock'
import { RaritiesBlock } from './blocks/RaritiesBlock'
import { RecordedBlock } from './blocks/RecordedBlock'
import { STATS_TITLE } from './copy'
import { useStats } from './useStats'

const CATALOG = TABS[0]

/**
 * A look back over the catalog. Counts and the recorded total always show; every other block
 * shows only when the catalog holds something for it.
 */
export function StatsPage({ now }: { now?: Date }) {
  const db = useDb()
  const router = useIonRouter()
  const openTabRoot = useOpenTabRoot()
  const [opened] = useState(() => now ?? new Date())
  const view = useStats(db, opened)
  const [, updateFilters, filtersError] = useCatalogFilters()

  // Every other filter and the search are cleared, so the catalog shows exactly the tunes the
  // value counted. The Settings stack keeps this page for the way back.
  const openCatalog = async (patch: Partial<CatalogFilters>) => {
    await updateFilters({ ...DEFAULT_FILTERS, ...patch })
    writeSearchQuery('catalog', '')
    openTabRoot(CATALOG)
  }

  return (
    <Screen title={STATS_TITLE} level="pushed" backHref="/settings" grouped>
      <h1 className="sr-only">{STATS_TITLE}</h1>
      {view ? (
        <>
          <CountsBlock counts={view.stats.counts} />
          <RecordedBlock
            recorded={view.stats.recorded}
            equivalence={view.stats.equivalence}
            tuneTitles={view.tuneTitles}
          />
          {view.stats.months.all_time.length > 0 ? (
            <MonthsBlock months={view.stats.months} />
          ) : null}
          {view.stats.heatmap.visible ? (
            <HeatmapBlock heatmap={view.stats.heatmap} today={view.today} />
          ) : null}
          {view.stats.on_this_day.length > 0 ? (
            <OnThisDayBlock
              lines={view.stats.on_this_day}
              tuneTitles={view.tuneTitles}
              recordingTitles={view.recordingTitles}
            />
          ) : null}
          <BreakdownsBlock
            breakdowns={view.stats.breakdowns}
            onFilter={openCatalog}
            error={filtersError}
          />
          {view.stats.rarities.length > 0 ? (
            <RaritiesBlock
              rarities={view.stats.rarities}
              tuneTitles={view.tuneTitles}
              onOpenTune={(tuneId) =>
                router.push(`/settings/stats/tunes/${tuneId}`, 'forward', 'push')
              }
            />
          ) : null}
        </>
      ) : null}
    </Screen>
  )
}

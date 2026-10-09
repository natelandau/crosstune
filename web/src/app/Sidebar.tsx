import { Plus } from 'lucide-react'
import { useId } from 'react'
import { Link, useLocation } from 'react-router'
import { Button as AriaButton } from 'react-aria-components'
import type { TuneStatus } from '../api/vocabulary'
import { useCatalogFilters } from '../features/catalog/useCatalogFilters'
import { useStatusCounts } from '../features/catalog/useStatusCounts'
import { useActiveLists, useMembershipCounts } from '../features/lists/useLists'
import { countTunes } from '../features/selection/copy'
import { destination, type Destination } from './destinations'
import { useDestination } from './useDestination'
import { Button } from '../ui/Button'
import { StatusGlyph } from '../ui/StatusGlyph'
import { useListNameLauncher } from '../features/lists/listNameLauncher'
import { DestinationLink } from './DestinationLink'
import { RecordControl } from './RecordControl'
import { SyncBadge } from './SyncBadge'

export const NEW_LIST = 'New list…'
export const SIDEBAR = 'Sidebar'

const STATUS_ROWS: TuneStatus[] = ['known', 'learning', 'want_to_learn']

const ROW =
  't-body flex min-h-(--target) w-full items-center gap-3 rounded-(--radius-row) px-3 text-start transition-opacity duration-(--dur-short) ease-(--ease) data-[pressed]:opacity-60'

const rowTone = (selected: boolean) => (selected ? 'bg-wash text-ink' : 'text-ink')
const glyphTone = (selected: boolean) => (selected ? 'text-coral' : 'text-ink-2')

/**
 * The digits are decoration; the row's description says the same in words, so the row's name
 * stays its label. Ink-2 on the selected wash falls short of 4.5:1, so a selected count is ink.
 */
function Count({
  id,
  value,
  selected,
}: {
  id: string
  value: number | undefined
  selected: boolean
}) {
  if (!value) return null
  return (
    <>
      <span
        aria-hidden
        data-count
        className={`t-caption t-num ms-auto ${selected ? 'text-ink' : 'text-ink-2'}`}
      >
        {value}
      </span>
      <span id={id} hidden>
        {countTunes(value)}
      </span>
    </>
  )
}

const describedBy = (id: string, value: number | undefined) => (value ? id : undefined)

function DestinationRow({
  id,
  selected,
  onChoose,
  count,
  countId,
}: {
  id: Destination
  selected: boolean
  onChoose?: () => void | Promise<unknown>
  count?: number
  countId: string
}) {
  const { icon: Icon, label, root } = destination(id)
  return (
    <DestinationLink
      to={id}
      href={root}
      current={selected}
      onChoose={onChoose}
      describedBy={describedBy(countId, count)}
      className={`${ROW} ${rowTone(selected)}`}
    >
      <Icon className={`size-5 shrink-0 ${glyphTone(selected)}`} aria-hidden />
      {label}
      <Count id={countId} value={count} selected={selected} />
    </DestinationLink>
  )
}

/** The split and wide frames' navigation. */
export function Sidebar() {
  const { current, root } = useDestination()
  const { pathname } = useLocation()
  const [filters, updateFilters] = useCatalogFilters()
  const counts = useStatusCounts()
  const lists = useActiveLists()
  const membership = useMembershipCounts(counts?.userTuneIds ?? [])
  const base = useId()
  const listName = useListNameLauncher()

  const inCatalog = current === 'catalog'
  const status = filters?.status ?? 'all'
  const listsSelected = pathname === destination('lists').root

  // The filter write lands before the catalog opens, so it never shows the old scope.
  const chooseStatus = async (value: TuneStatus) => {
    await updateFilters({ status: value }).catch(() => {})
    root('catalog')
  }

  return (
    <nav
      aria-label={SIDEBAR}
      data-nav
      className="bg-nav relative m-2 flex w-60 shrink-0 flex-col gap-4 overflow-y-auto rounded-(--radius-surface) p-3"
    >
      <div className="flex min-h-6 items-center px-3">
        <SyncBadge />
      </div>
      <div className="flex flex-col gap-0.5">
        <DestinationRow
          id="catalog"
          selected={inCatalog && status === 'all'}
          onChoose={() => updateFilters({ status: 'all' })}
          count={counts?.total}
          countId={`${base}-catalog`}
        />
        {STATUS_ROWS.map((value) => {
          const selected = inCatalog && status === value
          const count = counts?.byStatus[value]
          return (
            <AriaButton
              key={value}
              aria-current={selected ? 'page' : undefined}
              aria-describedby={describedBy(`${base}-${value}`, count)}
              className={`${ROW} ${rowTone(selected)} ps-10`}
              onPress={() => void chooseStatus(value)}
            >
              <StatusGlyph status={value} labelled />
              <Count id={`${base}-${value}`} value={count} selected={selected} />
            </AriaButton>
          )
        })}
        <DestinationRow
          id="recordings"
          selected={current === 'recordings'}
          countId={`${base}-recordings`}
        />
      </div>
      <section aria-labelledby={`${base}-lists`} className="flex flex-col gap-0.5">
        <div
          className={`flex items-center justify-between rounded-(--radius-row) ps-3 ${listsSelected ? 'bg-wash' : ''}`}
        >
          <h2 id={`${base}-lists`} className="min-w-0 flex-1">
            <DestinationLink
              to="lists"
              href={destination('lists').root}
              current={listsSelected}
              className={`t-caption flex min-h-(--target) items-center ${listsSelected ? 'text-ink' : 'text-ink-2'}`}
            >
              {destination('lists').label}
            </DestinationLink>
          </h2>
          <Button iconOnly icon={Plus} label={NEW_LIST} onPress={listName.open} />
        </div>
        {lists?.map((list) => {
          const selected = pathname.startsWith(`/lists/${list.id}`)
          const count = membership?.get(list.id)
          const countId = `${base}-list-${list.id}`
          return (
            <Link
              key={list.id}
              to={`/lists/${list.id}`}
              aria-current={selected ? 'page' : undefined}
              aria-describedby={describedBy(countId, count)}
              className={`${ROW} ${rowTone(selected)}`}
            >
              <span className="truncate">{list.name}</span>
              <Count id={countId} value={count} selected={selected} />
            </Link>
          )
        })}
      </section>
      <div className="mt-auto flex flex-col gap-3">
        <DestinationRow
          id="settings"
          selected={current === 'settings'}
          countId={`${base}-settings`}
        />
        <RecordControl shape="capsule" />
      </div>
    </nav>
  )
}

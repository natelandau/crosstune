import { Fragment } from 'react'
import type { Key, Selection } from 'react-aria-components'
import { Link, useMatch, useNavigate, useParams } from 'react-router'
import { SETTINGS_STATS_PATH, settingsPagePath } from './settingsPaths'
import { storedAudioQuality } from '../../db/recordings'
import { storedNewTuneGenre } from '../../db/types'
import { NOT_SET } from '../../ui/fieldCopy'
import { useAppearance } from '../../theme/appearance'
import { syncedLine } from './lastSynced'
import { aboutLine, SETTINGS_CATEGORIES } from './settingsCopy'
import { useAccountSettings } from './useAccountSettings'
import { useInstrumentsSetting } from './useInstrumentsSetting'
import { useMusicServicesSetting } from './useMusicServicesSetting'
import { useSettingsRow } from './useSettingsRow'
import { useStatsSummary } from './useStatsSummary'
import { useSyncSettings } from './useSyncSettings'
import { SUMMARY_SEPARATOR } from '../stats/copy'
import { APP_VERSION } from '../../version'
import { useLeaveTo } from '../../app/backTrail'
import { destination } from '../../app/destinations'
import { useStampedDensity } from '../../platform/density'
import { useFrame } from '../../platform/frame'
import { ColumnTitle } from '../../app/ColumnTitle'
import { PaneBar } from '../../app/PaneBar'
import { SYNC_ATTENTION } from '../../app/syncAttention'
import { Row } from '../../ui/Row'
import { RowList } from '../../ui/RowList'
import { StatusSplitBar } from '../../ui/StatusSplitBar'
import { useNow } from '../../ui/useNow'
import { isSettingsPage, SETTINGS_PAGES, type SettingsValues } from './settingsPages'

const SETTINGS = destination('settings')
const CATEGORIES = SETTINGS_PAGES.filter((page) => page.id !== 'account')
const BLOCK = 'bg-fill block rounded-(--radius-surface) px-4 py-3'

/**
 * The Settings root: the account and the catalog as blocks, then a row for each category, and
 * the version below. Each opens its page, pushed on phone and split and in the detail on wide.
 */
export function SettingsRoot() {
  const { page } = useParams()
  const open = isSettingsPage(page) ? page : undefined
  const wide = useFrame() === 'wide'
  const touch = useStampedDensity() === 'touch'
  const navigate = useNavigate()
  const values = useSettingsValues()
  const statsOpen = useMatch(`${SETTINGS_STATS_PATH}/*`) !== null
  const statsTune = useMatch(`${SETTINGS_STATS_PATH}/tunes/:tuneId`) !== null
  // On wide one page replaces the one before, so walking the rows with the arrows leaves no
  // entry in history for every page passed.
  const replace = wide && (open !== undefined || statsOpen)
  const choose = (key: Key) => {
    const id = String(key)
    if (!isSettingsPage(id) || id === open) return
    void navigate(settingsPagePath(id), { replace })
  }

  return (
    <>
      <PaneBar title={SETTINGS.label} />
      <ColumnTitle title={SETTINGS.label} />
      <div className="flex flex-col gap-4 px-4 pb-4">
        <AccountBlock current={open === 'account'} replace={replace} />
        <StatsBlock current={statsOpen} replace={wide && open !== undefined} fromTune={statsTune} />
      </div>
      <RowList
        label={SETTINGS_CATEGORIES}
        {...(wide
          ? {
              selectionMode: 'single',
              // Selection follows focus only once a page is open, so tabbing into the list
              // never opens one.
              selectionBehavior: open ? 'replace' : 'toggle',
              disallowEmptySelection: true,
              selectedKeys: new Set(open ? [open] : []),
              onSelectionChange: (keys: Selection) => {
                if (keys === 'all') return
                const [key] = keys
                if (key !== undefined) choose(key)
              },
            }
          : { onAction: choose })}
      >
        {CATEGORIES.map((category) => {
          const summary = category.summary?.(values)
          const Icon = category.icon
          return (
            <Row
              key={category.id}
              id={category.id}
              textValue={summary ? `${category.title}, ${summary}` : category.title}
              leading={<Icon className="text-slate size-5 shrink-0" aria-hidden />}
              title={category.title}
              trailing={
                summary ? (
                  // On pointer the row's trailing slot holds the cap, so a percentage here
                  // would take half of a width the text itself sets.
                  <span
                    className={`t-body text-ink-2 min-w-0 truncate pe-1 ${touch ? 'max-w-1/2 shrink-0' : ''}`}
                  >
                    {summary}
                  </span>
                ) : undefined
              }
            />
          )
        })}
      </RowList>
      <p className="t-secondary text-ink-2 px-4 pt-6 pb-8">{aboutLine(APP_VERSION)}</p>
    </>
  )
}

function useSettingsValues(): SettingsValues {
  const instruments = useInstrumentsSetting()
  const services = useMusicServicesSetting()
  const row = useSettingsRow()
  const quality = storedAudioQuality(row)
  const appearance = useAppearance()
  return {
    instruments: instruments.instruments ? instruments.summary : '',
    newTunes: row === undefined ? '' : (storedNewTuneGenre(row) ?? NOT_SET),
    services: services.providers ? services.summary : '',
    quality,
    appearance,
  }
}

/** Who is signed in, with the sync state as its second line in the sync badge's color. */
function AccountBlock({ current, replace }: { current: boolean; replace: boolean }) {
  const { identity, label } = useAccountSettings()
  const { status, statusLabel, lastSynced } = useSyncSettings()
  const now = useNow()
  const tone = SYNC_ATTENTION[status]
  return (
    <Link
      to={settingsPagePath('account')}
      replace={replace}
      aria-current={current ? 'page' : undefined}
      className={`${BLOCK} aria-[current=page]:bg-wash`}
    >
      <span className="t-body block truncate">{identity?.name ?? label}</span>
      <span className={`t-secondary block truncate ${tone ?? 'text-ink-2'}`}>
        {tone ? statusLabel : syncedLine(lastSynced, now)}
      </span>
    </Link>
  )
}

/**
 * The catalog in one line over a bar split by status, opening the stats page. While a tune
 * opened from the stats shows, it leaves the tune for the stats, as Back would.
 */
function StatsBlock({
  current,
  replace,
  fromTune,
}: {
  current: boolean
  replace: boolean
  fromTune: boolean
}) {
  const summary = useStatsSummary()
  const leave = useLeaveTo()
  // Until the rows are read, an empty block holds the place so the rows below never shift.
  if (!summary)
    return (
      <div aria-hidden className={BLOCK}>
        <span className="t-body block"> </span>
      </div>
    )
  const { parts, byStatus } = summary
  return (
    <Link
      to={SETTINGS_STATS_PATH}
      // Unset, a link to the address already shown replaces it rather than stacking a copy.
      replace={replace || undefined}
      aria-current={current ? 'page' : undefined}
      className={`${BLOCK} aria-[current=page]:bg-wash`}
      onClick={(event) => {
        if (!fromTune || event.defaultPrevented || event.button !== 0) return
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        leave(SETTINGS_STATS_PATH)
      }}
    >
      <span className="t-body t-num block">
        {/* The line breaks only between parts, never inside a count such as "9 h 12 m". */}
        {parts.map((part, index) => (
          <Fragment key={index}>
            {index > 0 && SUMMARY_SEPARATOR}
            <span className="whitespace-nowrap">{part}</span>
          </Fragment>
        ))}
      </span>
      <StatusSplitBar byStatus={byStatus} named className="mt-2 h-1.5" />
    </Link>
  )
}

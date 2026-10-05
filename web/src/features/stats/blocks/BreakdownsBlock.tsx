import { useState, type ReactNode } from 'react'
import { MODES } from '../../../api/vocabulary'
import { isInstrument } from '../../../db/types'
import { PressTarget } from '../../../ui/Capsule'
import { Group } from '../../../ui/Group'
import { KeyPill } from '../../../ui/KeyPill'
import { FACET_LABELS, isFilterValue, type CatalogFilters, type Facet } from '../../catalog/filters'
import { tuningKey, tuningLabel } from '../../settings/instruments'
import { DETAIL_LABELS } from '../../tune/detailFields'
import { isMode } from '../../tune/keyMode'
import { KEY_GRID_CAPTION, keyCellLabel, keyModeCellLabel, MODE_COLUMNS } from '../copy'
import type { Breakdowns, KeyRow, Value } from '../types'
import { compareText } from '../../../text/spelling'
import { CountItem } from './CountItem'

type Filter = (patch: Partial<CatalogFilters>) => void

/**
 * One group per attribute the catalog uses, in a fixed order. A value that is a catalog filter
 * opens the catalog filtered by it; time signature only counts. A filter that could not be
 * saved reports under the group whose write failed.
 */
export function BreakdownsBlock({
  breakdowns,
  onFilter,
  error,
}: {
  breakdowns: Breakdowns
  /** Rejects when the filter could not be saved. */
  onFilter: (patch: Partial<CatalogFilters>) => Promise<void>
  /** Why the last filter could not be saved, or null. */
  error: string | null
}) {
  // The group whose write failed, set only once it has, so a later tap elsewhere never carries
  // the message over before its own write settles. A write that succeeds clears the error.
  const [failed, setFailed] = useState<string | null>(null)
  const filterFrom =
    (header: string): Filter =>
    (patch) => {
      onFilter(patch).catch(() => setFailed(header))
    }
  const errorFor = (header: string) => (failed === header ? error : null)
  return (
    <>
      {breakdowns.key.length > 0 ? (
        <KeyGrid
          rows={breakdowns.key}
          onFilter={filterFrom(FACET_LABELS.key)}
          error={errorFor(FACET_LABELS.key)}
        />
      ) : null}
      <Values
        header={FACET_LABELS.tune_type}
        values={breakdowns.tune_type}
        facet="tune_type"
        onOpen={(value) => filterFrom(FACET_LABELS.tune_type)({ tune_type: value })}
        error={errorFor(FACET_LABELS.tune_type)}
      />
      {breakdowns.tunings.map(({ instrument, values }) =>
        isInstrument(instrument) ? (
          <Values
            key={instrument}
            header={tuningLabel(instrument)}
            values={values}
            facet={tuningKey(instrument)}
            onOpen={(value) =>
              filterFrom(tuningLabel(instrument))({ [tuningKey(instrument)]: value })
            }
            error={errorFor(tuningLabel(instrument))}
          />
        ) : null,
      )}
      <Values
        header={FACET_LABELS.genre}
        values={breakdowns.genre}
        facet="genre"
        onOpen={(value) => filterFrom(FACET_LABELS.genre)({ genre: value })}
        error={errorFor(FACET_LABELS.genre)}
      />
      <Values header={DETAIL_LABELS.time_signature} values={breakdowns.time_signature} />
      <Values
        header={FACET_LABELS.composer}
        values={breakdowns.composer}
        facet="composer"
        onOpen={(value) => filterFrom(FACET_LABELS.composer)({ composer: value })}
        error={errorFor(FACET_LABELS.composer)}
      />
      <Values
        header={FACET_LABELS.learned_from}
        values={breakdowns.learned_from}
        facet="learned_from"
        onOpen={(value) => filterFrom(FACET_LABELS.learned_from)({ learned_from: value })}
        error={errorFor(FACET_LABELS.learned_from)}
      />
    </>
  )
}

/** A value opens the catalog only when `facet` can filter by it; any other only reads. */
function Values({
  header,
  values,
  facet,
  onOpen,
  error = null,
}: {
  header: string
  values: readonly Value[]
  facet?: Facet
  onOpen?: (value: string) => void
  error?: string | null
}) {
  if (values.length === 0) return null
  return (
    <Group header={header} error={error}>
      {values.map(({ value, count }) => (
        <CountItem
          key={value}
          label={value}
          count={count}
          onOpen={onOpen && facet && isFilterValue(facet, value) ? () => onOpen(value) : undefined}
        />
      ))}
    </Group>
  )
}

/** The modes some tune in a key holds, in vocabulary order, then any the client does not know. */
function usedModes(rows: readonly KeyRow[]): string[] {
  const used = new Set(rows.flatMap((row) => row.modes.map((mode) => mode.value)))
  const unknown = [...used].filter((mode) => !isMode(mode)).sort(compareText)
  return [...MODES.filter((mode) => used.has(mode)), ...unknown]
}

/**
 * Keys down, modes across. A key's own control filters by the key alone, with its total; a cell
 * filters by the key and the mode together.
 */
function KeyGrid({
  rows,
  onFilter,
  error,
}: {
  rows: readonly KeyRow[]
  onFilter: Filter
  error: string | null
}) {
  const modes = usedModes(rows)
  return (
    <Group header={FACET_LABELS.key} plain error={error}>
      <div className="overflow-x-auto px-(--form-gutter)">
        <table className="w-full border-collapse tabular-nums">
          <caption className="sr-only">{KEY_GRID_CAPTION}</caption>
          <thead>
            <tr>
              <th scope="col" className="type-footnote text-start">
                {FACET_LABELS.key}
              </th>
              {modes.map((mode) => (
                <th key={mode} scope="col" className="type-footnote text-center">
                  <span aria-hidden="true">{isMode(mode) ? MODE_COLUMNS[mode] : mode}</span>
                  <span className="sr-only">{mode}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className="text-start">
                  <GridCell
                    label={keyCellLabel(row.key, row.count)}
                    onPress={
                      isFilterValue('key', row.key) ? () => onFilter({ key: row.key }) : undefined
                    }
                  >
                    <span className="type-body flex items-center gap-2">
                      <KeyPill value={row.key} compact />
                      {row.count.toLocaleString('en-US')}
                    </span>
                  </GridCell>
                </th>
                {modes.map((mode) => {
                  const count = row.modes.find((held) => held.value === mode)?.count
                  return (
                    <td key={mode} className="text-center">
                      {count ? (
                        <GridCell
                          label={keyModeCellLabel(row.key, mode, count)}
                          onPress={
                            isFilterValue('key', row.key) && isFilterValue('mode', mode)
                              ? () => onFilter({ key: row.key, mode })
                              : undefined
                          }
                        >
                          <span className="type-body">{count.toLocaleString('en-US')}</span>
                        </GridCell>
                      ) : null}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Group>
  )
}

/** A grid cell that filters the catalog, or only reads when its value cannot be a filter. */
function GridCell({
  label,
  onPress,
  children,
}: {
  label: string
  onPress: (() => void) | undefined
  children: ReactNode
}) {
  if (onPress)
    return (
      <PressTarget label={label} onPress={onPress}>
        {children}
      </PressTarget>
    )
  return (
    <span className="grid min-h-11 min-w-11 place-items-center">
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">{children}</span>
    </span>
  )
}

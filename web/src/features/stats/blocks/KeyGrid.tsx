import type { ReactNode } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { FACET_LABELS, isFilterValue, type CatalogFilters } from '../../catalog/filters'
import { usedModes } from '../breakdowns'
import { KEY_GRID_CAPTION, keyCellLabel, keyModeCellLabel, MODE_COLUMNS } from '../copy'
import type { KeyRow } from '../types'
import { isMode } from '../../tune/keyMode'
import { PageSection } from '../../../ui/PageSection'
import { ErrorLine } from '../../../ui/ErrorLine'
import { KeyPill } from '../../../ui/KeyPill'
import { PRESS } from './press'

/**
 * Keys down, modes across, each key in its own hue. A key's cell filters by the key alone, with
 * its total; a mode cell filters by the key and the mode together.
 */
export function KeyGrid({
  rows,
  onFilter,
  error,
}: {
  rows: readonly KeyRow[]
  onFilter: (patch: Partial<CatalogFilters>) => void
  error: string | null
}) {
  const modes = usedModes(rows)
  return (
    <PageSection title={FACET_LABELS.key}>
      <div className="-mx-2 overflow-x-auto px-2">
        <table className="w-full border-collapse">
          <caption className="sr-only">{KEY_GRID_CAPTION}</caption>
          <thead>
            <tr>
              <th scope="col" className="t-caption text-ink-2 text-start font-normal">
                {FACET_LABELS.key}
              </th>
              {modes.map((mode) => (
                <th key={mode} scope="col" className="t-caption text-ink-2 text-center font-normal">
                  <span aria-hidden>{isMode(mode) ? MODE_COLUMNS[mode] : mode}</span>
                  <span className="sr-only">{mode}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className="text-start font-normal">
                  <Cell
                    label={keyCellLabel(row.key, row.count)}
                    onPress={
                      isFilterValue('key', row.key) ? () => onFilter({ key: row.key }) : undefined
                    }
                  >
                    <span className="flex items-center gap-2">
                      <KeyPill value={row.key} compact />
                      <span className="t-body t-num">{row.count.toLocaleString('en-US')}</span>
                    </span>
                  </Cell>
                </th>
                {modes.map((mode) => {
                  const count = row.modes.find((held) => held.value === mode)?.count
                  return (
                    <td key={mode} className="text-center">
                      {count ? (
                        <Cell
                          label={keyModeCellLabel(row.key, mode, count)}
                          onPress={
                            isFilterValue('key', row.key) && isFilterValue('mode', mode)
                              ? () => onFilter({ key: row.key, mode })
                              : undefined
                          }
                        >
                          <span className="t-body t-num">{count.toLocaleString('en-US')}</span>
                        </Cell>
                      ) : null}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorLine error={error} place="inline" />
    </PageSection>
  )
}

const CELL =
  'inline-grid min-h-(--target) min-w-(--target) place-items-center rounded-(--radius-row)'

/** A cell that filters the catalog, or only reads when its value cannot be a filter. */
function Cell({
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
      <AriaButton aria-label={label} onPress={onPress} className={`${CELL} ${PRESS}`}>
        {children}
      </AriaButton>
    )
  return (
    <span className={CELL}>
      <span className="sr-only">{label}</span>
      <span aria-hidden>{children}</span>
    </span>
  )
}

import { Check, Minus } from 'lucide-react'
import { COMPARISON, type Cell } from './comparison'
import { FeatureIcon } from './FeatureIcon'
import { COMPARE_FREE, COMPARE_PREMIUM } from './planCopy'

/** What assistive tech reads for a check and a dash. */
export const CELL_INCLUDED = 'Included'
export const CELL_EXCLUDED = 'Not included'

const COLUMN = 'w-20 px-1 text-center'
const PREMIUM_COLUMN = `${COLUMN} bg-premium-wash`

/**
 * Free beside Premium, a row per feature with its icon. Premium's header is a coral tab over a
 * slate-washed column, so the plan being sold carries the weight.
 */
export function PlanComparison() {
  return (
    <div className="bg-fill overflow-hidden rounded-(--radius-surface)">
      <table className="t-secondary w-full border-collapse">
        <thead>
          <tr className="t-caption align-bottom">
            <td />
            <th scope="col" className={`${COLUMN} text-ink-2 pt-3 pb-1.5`}>
              {COMPARE_FREE}
            </th>
            {/* Collapsed table cells ignore border-radius, so the tab is a block inside the cell. */}
            <th scope="col" className="w-20 px-0 pt-3 pb-0 text-center">
              <span className="bg-coral text-on-coral block rounded-t-(--radius-row) py-1.5 font-semibold">
                {COMPARE_PREMIUM}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON.map((feature) => (
            <tr key={feature.title} className="border-hairline border-t">
              <th scope="row" className="py-2 ps-3 pe-2 text-start font-normal">
                <span className="flex items-center gap-3">
                  <FeatureIcon icon={feature.icon} size="small" />
                  <span className="min-w-0 break-words">{feature.title}</span>
                </span>
              </th>
              <td className={COLUMN}>
                <CellMark cell={feature.free} premium={false} />
              </td>
              <td className={PREMIUM_COLUMN}>
                <CellMark cell={feature.premium} premium />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CellMark({ cell, premium }: { cell: Cell; premium: boolean }) {
  if (cell.kind === 'value') {
    return (
      <span className={premium ? 'text-premium-ink font-semibold' : 'text-ink-2'}>{cell.text}</span>
    )
  }
  const included = cell.kind === 'included'
  const Icon = included ? Check : Minus
  const ink = premium ? 'text-slate' : included ? 'text-ink-2' : 'text-glyph-faint'
  return (
    <>
      <Icon className={`inline-block size-4 ${ink}`} strokeWidth={premium ? 2.75 : 2} aria-hidden />
      <span className="sr-only">{included ? CELL_INCLUDED : CELL_EXCLUDED}</span>
    </>
  )
}

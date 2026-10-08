import { ON_THIS_DAY_HEADER, onThisDayLine } from '../copy'
import type { OnThisDay as OnThisDayLine } from '../types'
import { PageSection } from '../../../ui/PageSection'

const RECORDING_KINDS: readonly OnThisDayLine['kind'][] = ['first_recording', 'recording']

export function OnThisDay({
  lines,
  tuneTitles,
  recordingTitles,
}: {
  lines: readonly OnThisDayLine[]
  tuneTitles: ReadonlyMap<string, string>
  recordingTitles: ReadonlyMap<string, string | null>
}) {
  return (
    <PageSection title={ON_THIS_DAY_HEADER}>
      <ul className="flex flex-col gap-2">
        {lines.map((line) => {
          const title = RECORDING_KINDS.includes(line.kind)
            ? (recordingTitles.get(line.id) ?? null)
            : (tuneTitles.get(line.id) ?? null)
          return (
            <li key={`${line.kind}:${line.id}`} className="t-body">
              {onThisDayLine(line, title)}
            </li>
          )
        })}
      </ul>
    </PageSection>
  )
}

import { Button as AriaButton } from 'react-aria-components'
import { useNavigate } from 'react-router'
import { listTunePath } from '../../app/tuneHome'
import {
  SKIP_LINKS_ONLY,
  SKIP_NOT_HERE,
  SKIP_NOTHING,
  WHAT_PLAYS_LEAD,
  WHAT_PLAYS_TITLE,
} from './listPlayCopy'
import type { ListItemView } from './useLists'
import type { PlaylistReport, SkipReason } from '../player/listSource'
import { DONE } from '../../ui/confirmCopy'
import { tunePick } from '../tune/tunePick'
import { FIELD_ROW_PRESSABLE } from '../../ui/form/FieldRow'
import { Group } from '../../ui/form/Group'
import { Sheet } from '../../ui/Sheet'

const GROUPS: readonly { reason: SkipReason; heading: string }[] = [
  { reason: 'nothing', heading: SKIP_NOTHING },
  { reason: 'linksOnly', heading: SKIP_LINKS_ONLY },
  { reason: 'notHere', heading: SKIP_NOT_HERE },
]

/** The tunes a list passes over when it plays, grouped by why. A tune opens its page. */
export function WhatPlaysSheet({
  listId,
  report,
  rows,
  isOpen,
  onOpenChange,
}: {
  listId: string
  report: PlaylistReport
  /** The rows the report was made from, which title its tunes. */
  rows: readonly ListItemView[]
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const titles = new Map(rows.map((row) => [row.tune.id, row.tune.title]))
  const close = () => onOpenChange(false)
  const open = (tuneId: string) => {
    close()
    void navigate(listTunePath(listId, tuneId), { state: tunePick() })
  }
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={WHAT_PLAYS_TITLE}
      height="part"
      leading={null}
      primary={{ label: DONE, onPress: close }}
    >
      <div className="pb-4">
        <p className="t-secondary text-ink-2 px-4 pt-2">{WHAT_PLAYS_LEAD}</p>
        {GROUPS.map(({ reason, heading }) => {
          const tuneIds = report.skipped[reason]
          if (tuneIds.length === 0) return null
          return (
            <Group key={reason} header={heading}>
              {tuneIds.map((tuneId, index) => (
                // A list can hold a tune twice, and each row counts.
                <AriaButton
                  key={`${tuneId}-${index}`}
                  onPress={() => open(tuneId)}
                  className={FIELD_ROW_PRESSABLE}
                >
                  <span className="min-w-0 flex-1 truncate">{titles.get(tuneId) ?? ''}</span>
                </AriaButton>
              ))}
            </Group>
          )
        })}
      </div>
    </Sheet>
  )
}

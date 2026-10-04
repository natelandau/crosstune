import { IonItem, IonLabel } from '@ionic/react'
import { Group } from '../../../ui/Group'
import {
  archivedLine,
  COUNTS_HEADER,
  KNOWN_LABEL,
  LEARNING_LABEL,
  LINKS_LABEL,
  LISTS_LABEL,
  RECORDINGS_LABEL,
  scansLine,
  TUNES_LABEL,
  UNKNOWN_LABEL,
} from '../copy'
import type { Counts } from '../types'
import { CountItem } from './CountItem'

/**
 * Always shown, at zero too. Archived tunes are counted only in the footer. Scans get a line only
 * when there are any.
 */
export function CountsBlock({ counts }: { counts: Counts }) {
  return (
    <Group
      header={COUNTS_HEADER}
      name={COUNTS_HEADER}
      footer={counts.archived > 0 ? archivedLine(counts.archived) : undefined}
    >
      <CountItem label={TUNES_LABEL} count={counts.tunes} />
      <CountItem label={KNOWN_LABEL} count={counts.known} />
      <CountItem label={LEARNING_LABEL} count={counts.learning} />
      <CountItem label={UNKNOWN_LABEL} count={counts.want_to_learn} />
      <CountItem label={LISTS_LABEL} count={counts.lists} />
      <CountItem label={RECORDINGS_LABEL} count={counts.recordings} />
      <CountItem label={LINKS_LABEL} count={counts.links} />
      {counts.scans > 0 ? (
        <IonItem lines="full">
          <IonLabel className="tabular-nums">{scansLine(counts.scans, counts.scan_tunes)}</IonLabel>
        </IonItem>
      ) : null}
    </Group>
  )
}

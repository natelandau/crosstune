import { IonItem, IonLabel } from '@ionic/react'
import { Group } from '../../../ui/Group'
import { RARITIES_HEADER, rarityLine } from '../copy'
import type { Rarity } from '../types'

/** Each line names the tune that holds the rare value and opens it. */
export function RaritiesBlock({
  rarities,
  tuneTitles,
  onOpenTune,
}: {
  rarities: readonly Rarity[]
  tuneTitles: ReadonlyMap<string, string>
  onOpenTune: (tuneId: string) => void
}) {
  return (
    <Group header={RARITIES_HEADER} name={RARITIES_HEADER}>
      {rarities.map((rarity) => (
        <IonItem
          key={`${rarity.attribute}:${rarity.instrument ?? ''}:${rarity.value}`}
          lines="full"
          button
          detail
          onClick={() => onOpenTune(rarity.tune_id)}
        >
          <IonLabel className="whitespace-normal">
            {rarityLine(rarity)}
            <p className="type-footnote">{tuneTitles.get(rarity.tune_id)}</p>
          </IonLabel>
        </IonItem>
      ))}
    </Group>
  )
}

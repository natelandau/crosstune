import { IonItem } from '@ionic/react'
import { ChevronRight } from 'lucide-react'
import { openTuneName } from './recordingNames'

/**
 * The line that heads one tune's recordings inside a card, and opens the tune. A row of the
 * card rather than a section header, so the tunes share one card instead of each costing a
 * card of its own; its heading lets assistive technology jump from tune to tune.
 */
export function TuneLabelLine({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <IonItem>
      <div className="relative flex min-h-11 w-full items-center gap-1">
        <h3 className="type-footnote m-0 min-w-0 flex-1 truncate font-semibold">{title}</h3>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-(--ion-color-medium)" />
        {/* A sibling of the heading rather than inside it, so the heading keeps the tune's name
            alone while the control reads as the verb and the tune. */}
        <button
          type="button"
          aria-label={openTuneName(title)}
          onClick={onOpen}
          className="absolute inset-0 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ion-color-primary)"
        />
      </div>
    </IonItem>
  )
}

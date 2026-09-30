import { KeyPill } from '../ui/KeyPill'

/** The site's paper list, line for line, so the app and crosstune.app tell one story. */
const PAPER: { text: string; note?: string; struck?: boolean }[] = [
  { text: 'A: Cluck Old Hen' },
  { text: 'Sally Goodin' },
  { text: 'Kitchen Girl', struck: true },
  { text: 'Breaking Up Xmas', note: 'learn!' },
  { text: "D: Soldier's Joy" },
  { text: 'Forked Deer' },
  { text: "Bonaparte's", note: 'DDAD' },
  { text: 'G: Sandy River Belle' },
  { text: '', note: 'ask Ann for recording' },
]

const GROUPS = [
  { key: 'A', rows: ['known', 'known', 'learning'] },
  { key: 'D', rows: ['known', 'known', 'learning'] },
] as const

const DOT = {
  known: 'bg-(--ion-color-success)',
  learning: 'bg-(--ion-color-warning)',
} as const

/**
 * The folded tune list a player keeps in the case, with a small phone over it showing the same
 * tunes sorted by key. Decorative: the headline beside it says the same thing in words. Drawn in
 * em from the footnote role, so the text size setting scales the whole picture.
 */
export function PaperEcho() {
  return (
    <div aria-hidden="true" className="paper-echo type-footnote">
      <div className="paper-echo-paper">
        <span className="paper-echo-fold" />
        {PAPER.map(({ text, note, struck }) => (
          <p key={text || note} className="m-0 whitespace-nowrap">
            {struck ? <s className="paper-echo-strike">{text}</s> : text}
            {text && note ? ' ' : null}
            {note ? <span className="text-(--ion-color-warning)">{note}</span> : null}
          </p>
        ))}
      </div>
      <div className="paper-echo-phone">
        <div className="paper-echo-screen">
          {/* Drawn at twice the size and halved, so the key pills keep their real proportions. */}
          <div className="paper-echo-app">
            <span className="paper-echo-bar mb-3 block h-3 w-1/2" />
            {GROUPS.map(({ key, rows }) => (
              <div key={key}>
                <div className="pt-2 pb-1">
                  <KeyPill value={key} compact />
                </div>
                {rows.map((status, i) => (
                  <div key={i} className="paper-echo-row flex items-center gap-2 py-2">
                    <span className={`size-2.5 shrink-0 rounded-full ${DOT[status]}`} />
                    <span className="paper-echo-bar h-2 flex-1" />
                    <span className="paper-echo-play size-4 shrink-0 rounded-full" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

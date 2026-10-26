import type { CSSProperties, ReactNode } from 'react'
import type { Provider, TuneStatus } from '../../api/vocabulary'
import { PROVIDER_LABELS } from '../../constants'
import { blend } from '../../features/tuner/blend'
import { greenness } from '../../features/tuner/pitch/notes'
import { TunerBars } from '../../features/tuner/TunerBars'
import { formatCents, hintLabel } from '../../features/tuner/tunerCopy'
import { KeyPill } from '../../ui/KeyPill'
import { StatusGlyph } from '../../ui/StatusGlyph'
import { TransportGlyph } from '../../ui/rowGlyphs'
import type { WELCOME_SLIDES } from '../../auth/links'

/*
 * The welcome slides' drawings, in the Apple app's proportions: each fills a 22.4 by 17 em box
 * at a fixed 12px em, so the headline under it never moves between slides. A short phone draws
 * them smaller, so the sign-in form's email field still shows without a scroll. Decorative: each
 * headline says the same thing in words, so every drawing is hidden from assistive tech and
 * takes no pointer, which also leaves a swipe to the carousel.
 */

type SlideId = (typeof WELCOME_SLIDES)[number]['id']

function Art({ children }: { children: ReactNode }) {
  return (
    <div
      aria-hidden
      data-slide-art
      className="max-welcome:[@media(max-height:700px)]:[zoom:0.6] pointer-events-none relative flex h-[17em] w-[22.4em] shrink-0 items-center justify-center text-[12px] select-none"
    >
      {children}
    </div>
  )
}

/** A short label on a card, as a chip in the app shows a setting. */
function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="border-hairline bg-surface text-ink rounded-(--radius-row) border px-[9px] py-[4px] text-[11px] leading-none font-semibold whitespace-nowrap">
      {children}
    </span>
  )
}

/** Bar heights, as shares of the waveform's height, for the slides' recordings. */
const RECORDED_LEVELS = [0.3, 0.7, 0.5, 0.9, 0.6, 0.8, 0.4, 0.75, 0.55, 0.85, 0.35, 0.65]

interface PaperLine {
  text: string
  note?: string
  struck?: boolean
}

/** The site's paper list, line for line, as the Apple app draws it. */
const PAPER: PaperLine[] = [
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

const PHONE_GROUPS: { key: string; rows: TuneStatus[] }[] = [
  { key: 'A', rows: ['known', 'known', 'learning'] },
  { key: 'D', rows: ['known', 'known', 'learning'] },
]

/**
 * The folded tune list a player keeps in the case, with a small phone over its right margin
 * showing the same tunes grouped by key.
 */
function PaperArt() {
  return (
    <Art>
      <div className="absolute inset-0">
        <div className="bg-surface border-hairline absolute top-[0.6em] left-[0.5em] flex h-[14.6em] w-[14.8em] -rotate-6 flex-col border px-[1em] py-[0.7em] shadow-(--shadow-float)">
          {PAPER.map((line, index) => (
            <div
              key={index}
              className="border-hairline flex h-[1.4em] items-end gap-[0.3em] border-b pb-[0.25em] leading-none whitespace-nowrap"
            >
              {line.text && (
                <span className={`text-ink-2 ${line.struck ? 'line-through' : ''}`}>
                  {line.text}
                </span>
              )}
              {line.note && <span className="text-ink italic">{line.note}</span>}
            </div>
          ))}
        </div>
        {/* Over the paper's right margin only, clear of its longest line. */}
        <div className="bg-device-bezel absolute top-[4.4em] left-[14.6em] h-[12em] w-[7.6em] rounded-[1.3em] p-[0.3em] shadow-(--shadow-float)">
          <div className="bg-ground h-full w-full overflow-hidden rounded-[1em]">
            <PhoneCatalog />
          </div>
        </div>
      </div>
    </Art>
  )
}

/**
 * The phone's screen, drawn at twice its size and halved, so the key pills and status glyphs
 * keep their real proportions.
 */
function PhoneCatalog() {
  return (
    <div className="flex h-[200%] w-[200%] origin-top-left scale-50 flex-col px-[0.9em] pt-[1.6em]">
      <div className="bg-field mb-[0.6em] h-[1em] w-[5em] rounded-full" />
      {PHONE_GROUPS.map((group) => (
        <div key={group.key} className="flex flex-col">
          <div className="mt-[0.6em] mb-[0.2em] flex">
            <KeyPill value={group.key} compact />
          </div>
          {group.rows.map((status, index) => (
            <div
              key={index}
              className="border-hairline flex items-center gap-[0.6em] border-b py-[0.6em]"
            >
              <StatusGlyph status={status} />
              <div className="bg-field h-[0.6em] flex-1 rounded-full" />
              <div className="bg-field size-[1.3em] rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

const CATALOG: { tune: string; status: TuneStatus }[] = [
  { tune: "Soldier's Joy", status: 'known' },
  { tune: 'Forked Deer', status: 'known' },
  { tune: "Bonaparte's Retreat", status: 'learning' },
  { tune: 'Ways of the World', status: 'want_to_learn' },
]

/** A part of the catalog under its key filter, one tune of each status. */
function CatalogArt() {
  return (
    <Art>
      <div className="border-hairline bg-surface flex w-[210px] flex-col rounded-(--radius-control) border px-[12px] py-[10px] shadow-(--shadow-float)">
        <div className="mb-[8px] flex gap-[5px]">
          {['A', 'D', 'G', 'C'].map((key) => (
            <KeyPill key={key} value={key} compact chosen={key === 'D'} />
          ))}
        </div>
        {CATALOG.map((row) => (
          <div
            key={row.tune}
            className="border-hairline text-ink flex items-center gap-[8px] border-b py-[5px] whitespace-nowrap last:border-b-0"
          >
            <StatusGlyph status={row.status} />
            {row.tune}
          </div>
        ))}
      </div>
    </Art>
  )
}

/** The record control with a recording's waveform over it and the tune it is filed under. */
function RecordArt() {
  return (
    <Art>
      <div className="flex flex-col items-center gap-[12px]">
        <div className="flex h-[44px] items-center gap-[3px]">
          {RECORDED_LEVELS.map((level, index) => (
            <div
              key={index}
              className="bg-record w-[4px] rounded-full"
              style={{ height: `${level * 100}%` }}
            />
          ))}
        </div>
        <div className="border-ink flex size-[54px] items-center justify-center rounded-full border-4">
          <div className="bg-record size-[20px] rounded-[5px]" />
        </div>
        <Chip>Filed under Sally Goodin</Chip>
      </div>
    </Art>
  )
}

const PRACTICE_LEVELS = [...RECORDED_LEVELS, ...RECORDED_LEVELS.toReversed(), ...RECORDED_LEVELS]
/** Where the loop starts and how much of the waveform it spans, as shares of its width. */
const LOOP_START = 0.44
const LOOP_SHARE = 0.3

/** A recording's waveform with a named loop over its hard part, and the settings that slow it. */
function PracticeArt() {
  const loop = { '--loop': 'var(--loop-1)', '--loop-tint': 'var(--loop-1-tint)' } as CSSProperties
  return (
    <Art>
      <div className="flex flex-col items-center gap-[16px] pt-[22px]" style={loop}>
        <div className="relative flex h-[50px] w-[220px] items-center gap-[2px]">
          {PRACTICE_LEVELS.map((level, index) => (
            <div
              key={index}
              className="bg-ink-2 flex-1 rounded-full opacity-50"
              style={{ height: `${level * 100}%` }}
            />
          ))}
          <div
            className="absolute -inset-y-[6px] rounded-[3px] border-x-2 border-(--loop) bg-(--loop-tint)"
            style={{ left: `${LOOP_START * 100}%`, width: `${LOOP_SHARE * 100}%` }}
          />
          <span
            className="absolute top-[-22px] text-[10px] font-semibold whitespace-nowrap text-(--loop)"
            style={{ left: `${LOOP_START * 100}%` }}
          >
            Tricky turn, B part
          </span>
        </div>
        <div className="flex gap-[8px]">
          <Chip>Speed 75%</Chip>
          <Chip>Pitch +1</Chip>
          <Chip>Loop on</Chip>
        </div>
      </div>
    </Art>
  )
}

const LISTEN: { tune: string; provider: Provider }[] = [
  { tune: 'Last Chance', provider: 'spotify' },
  { tune: 'Half Past Four', provider: 'youtube' },
  { tune: 'June Apple', provider: 'apple_music' },
]

/**
 * Tunes playing from the services they are linked on, the first playing in the app. Each row
 * names its service in words, since the app carries no service logos.
 */
function ListenArt() {
  return (
    <Art>
      <div className="border-hairline bg-surface flex w-[236px] flex-col rounded-(--radius-control) border px-[12px] py-[10px] shadow-(--shadow-float)">
        {LISTEN.map((row, index) => {
          const playing = index === 0
          return (
            <div
              key={row.tune}
              className={`flex items-center gap-3 rounded-(--radius-row) px-2 py-1.5 ${playing ? 'bg-(--play-wash)' : ''}`}
            >
              <span className="flex w-7 shrink-0 items-center">
                <TransportGlyph shape={playing ? 'stop' : 'play'} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="t-body text-ink whitespace-nowrap">{row.tune}</span>
                <span className="t-secondary text-ink-2 whitespace-nowrap">
                  {PROVIDER_LABELS[row.provider]}
                </span>
              </span>
            </div>
          )
        })}
      </div>
    </Art>
  )
}

/** Inside the target zone but past in tune, so the bars lean toward green and the hint shows. */
const TUNER_CENTS = 6

/** The Tuner screen's stage reading an A a little sharp, on the jet ground it always draws on. */
function TunerArt() {
  const green = greenness(TUNER_CENTS)
  return (
    <Art>
      <div
        data-practice
        className="relative h-[16em] w-[22.4em] overflow-hidden rounded-(--radius-surface) text-(--panel-ink)"
        style={{ colorScheme: 'dark', backgroundColor: blend('--jet', '--tune-wash', green) }}
      >
        <TunerBars cents={TUNER_CENTS} />
        <div className="absolute inset-0 grid grid-rows-[1fr_auto_1fr] justify-items-center">
          <p className="row-start-2 m-0 flex items-baseline text-[56px] leading-none font-light">
            A<span className="text-[20px]">4</span>
          </p>
          <div className="row-start-3 flex flex-col items-center gap-[4px] pt-[4px]">
            <p className="m-0 text-[15px] font-semibold tabular-nums">{formatCents(TUNER_CENTS)}</p>
            <p className="m-0 text-[12px] text-(--panel-muted)">{hintLabel(TUNER_CENTS)}</p>
          </div>
        </div>
      </div>
    </Art>
  )
}

export const SLIDE_ART: Record<SlideId, () => ReactNode> = {
  story: PaperArt,
  catalog: CatalogArt,
  record: RecordArt,
  practice: PracticeArt,
  listen: ListenArt,
  tuner: TunerArt,
}

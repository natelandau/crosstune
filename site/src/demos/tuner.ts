// Tuner: the iPhone hears a fiddle's A string 30 cents flat. As it is tuned up, the bars at each
// edge rise and change color, and once it is in tune they sit level with the note and the
// screen takes on a green wash.
import { phone } from './atoms'
import { $, $$ } from './runner'
import type { DemoDef } from './types'

/** Where the demo's A string starts, in cents. */
const START = -30

/** The furthest a bar travels, in cents and as a share of the stage's height, as the app draws it. */
const FULL_CENTS = 50
const FULL_TRAVEL = 0.4
const BAR_HEIGHT = 0.3

type Step = 'in' | 'close' | 'far'

const stepOf = (c: number): Step => (Math.abs(c) <= 3 ? 'in' : Math.abs(c) <= 15 ? 'close' : 'far')

const centsText = (c: number) => {
  const tenths = Math.round(c * 10) / 10
  return `${tenths < 0 ? '−' : '+'}${Math.abs(tenths).toFixed(1)}¢`
}

const hintText = (c: number) => (c < -3 ? 'Flat' : c > 3 ? 'Sharp' : '')

/** A bar's vertical shift as a share of its own height: down when flat, up when sharp. */
const barShift = (c: number) => {
  const clamped = Math.max(-FULL_CENTS, Math.min(FULL_CENTS, c))
  return `0 ${((-clamped / FULL_CENTS) * FULL_TRAVEL * 100) / BAR_HEIGHT}%`
}

const bar = (side: 'l' | 'r') =>
  `<i class="tu-bar ${side}" data-bar style="translate:${barShift(START)}"></i>`

const markup = () => `
  <div class="hw-phone" data-c data-y="48" data-ym="50"><div class="ph tu" data-tu data-step="${stepOf(START)}">${phone(
    `
      <div class="ph-nav"></div>
      <div class="ph-lt tu-title">Tuner<span class="tu-acct">MR</span></div>
      <div class="tu-stage">
        ${bar('l')}${bar('r')}
        <div class="tu-read">
          <div class="tu-note">A<span>4</span></div>
          <div class="tu-under"><b data-cents>${centsText(START)}</b><span data-hint>${hintText(START)}</span></div>
        </div>
      </div>`,
    { tab: 2 },
  )}</div></div>`

const outCubic = (x: number) => 1 - (1 - x) ** 3

export const tuner: DemoDef = {
  kind: 'tall',
  h: 964,
  hm: 966,
  label: "Crosstune's tuner bringing a fiddle's A string from flat into tune",
  markup,
  async script(d) {
    const st = d.stage
    const screen = $('[data-tu]', st)
    const cents = $('[data-cents]', st)
    const hint = $('[data-hint]', st)
    const bars = $$('[data-bar]', st)
    const show = (c: number) => {
      screen.dataset.step = stepOf(c)
      cents.textContent = centsText(c)
      hint.textContent = hintText(c)
      for (const b of bars) b.style.translate = barShift(c)
    }
    // A bowed string wavers a little around where the peg leaves it.
    const glide = (from: number, to: number, ms: number, waver: number) =>
      d.anim(ms, (p) => show(from + (to - from) * outCubic(p) + Math.sin(p * 19) * waver * (1 - p)))

    await d.wait(1200)
    await glide(START, -11, 1800, 1.2)
    await d.wait(700)
    await glide(-11, -2.4, 1500, 0.8)
    await d.wait(500)
    await glide(-2.4, 0.3, 900, 0.3)
    await d.wait(2800)
  },
}

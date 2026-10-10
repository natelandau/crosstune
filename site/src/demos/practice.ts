// Practice: a close crop of the desktop practice view. Speed drops to 75%, the pitch steps down a
// whole tone, and a loop named "B part turn" is drawn and repeats.
import { ic, kp, wave } from './atoms'
import { $, $$ } from './runner'
import type { DemoDef } from './types'

/** Bars in the big waveform. */
const BARS = 96

const markup = () => `
  <div class="pf" data-r="0" data-y="48" data-ym="40">
    <div class="pf-in">
      <div class="pf-head"><div><small>Billy in the Lowground</small><b>Rhys's fiddle, slow</b></div>${kp('C', '', 'big" data-key="1')}</div>
    </div>
    <div class="pf-mini"><div class="wave">${wave(150, 4, 30, 3)}</div><div class="pf-win"></div><i class="pf-mk"></i></div>
    <div class="pf-ruler">${[0, 1, 2, 3, 4, 5, 6]
      .map(
        (i) =>
          `<span style="right:${40 + i * 190}px">0:${String(40 - i * 5).padStart(2, '0')}</span>`,
      )
      .join('')}</div>
    <div class="pf-wave" data-wv>
      <div class="wave" data-bars>${wave(BARS, 2.2, 230, 10)}</div>
      <div class="pf-band" data-band><span class="lab" data-lab>B part turn</span><span class="h a"></span><span class="h b"></span></div>
      <div class="pf-ph" data-ph style="left:40%"></div>
    </div>
    <div class="pf-in">
      <div class="pf-loops" data-loops><span>Loops</span><span class="lp dim">${ic('plus')}New loop</span></div>
      <div class="pf-ctl">
        <div class="pf-tr"><span class="sk">${ic('skipb')}15</span><span class="big">${ic('pause')}</span><span class="sk">${ic('skipf')}15</span><span class="pf-time" data-cur>0:22.0</span></div>
        <div class="pf-box">
          <div class="pf-lab"><span>Speed</span><span data-spd>100%</span></div>
          <div class="pf-slider"><i class="f" data-fill style="width:100%"></i><i class="th" data-thumb style="left:100%"></i></div>
          <div class="pf-pre"><span>50%</span><span data-p75>75%</span><span class="on" data-p100>100%</span></div>
        </div>
        <div class="pf-box">
          <div class="pf-lab"><span>Pitch</span><span data-pname>Original key</span></div>
          <div class="pf-step"><span class="b" data-minus>−</span><span class="v" data-pitch>0</span><span class="b">+</span></div>
        </div>
      </div>
    </div>
  </div>`

const outQuad = (x: number) => x * (2 - x)

export const practice: DemoDef = {
  kind: 'zoom',
  h: 840,
  hm: 860,
  label:
    'The practice view on a computer: the speed drops to 75 percent, the pitch shifts down a whole step, and a loop named B part turn repeats.',
  markup,
  async script(d) {
    const st = d.stage
    const head = $('[data-ph]', st)
    const band = $('[data-band]', st)
    const cur = $('[data-cur]', st)
    const bars = $$('[data-bars] i', st)
    const setPlayhead = (p: number) => {
      head.style.left = `${p}%`
      const t = 6 + p * 0.4
      cur.textContent = `0:${String(Math.floor(t)).padStart(2, '0')}.${Math.floor((t % 1) * 10)}`
      const played = Math.floor((p / 100) * BARS)
      bars.forEach((b, i) => b.classList.toggle('p', i < played))
    }
    setPlayhead(40)
    await d.anim(1600, (p) => setPlayhead(40 + p * 10))

    const thumb = $('[data-thumb]', st)
    const fill = $('[data-fill]', st)
    const speed = $('[data-spd]', st)
    await d.click($('[data-p75]', st))
    $('[data-p100]', st).classList.remove('on')
    $('[data-p75]', st).classList.add('on')
    await d.anim(
      700,
      (p) => {
        const v = 100 - p * 50
        thumb.style.left = `${v}%`
        fill.style.width = `${v}%`
        speed.textContent = `${Math.round(100 - p * 25)}%`
      },
      outQuad,
    )
    await d.anim(1300, (p) => setPlayhead(50 + p * 6))

    const minus = $('[data-minus]', st)
    const pitch = $('[data-pitch]', st)
    const name = $('[data-pname]', st)
    const key = $('[data-key]', st)
    await d.click(minus)
    pitch.textContent = '−1'
    name.textContent = 'Now B'
    key.className = 'kp k11 big'
    key.textContent = 'B'
    await d.wait(300)
    await d.click(minus)
    pitch.textContent = '−2'
    name.textContent = 'Now B♭'
    key.className = 'kp k10 big'
    key.textContent = 'B♭'
    await d.wait(400)

    const wv = $('[data-wv]', st)
    band.style.left = '62%'
    await d.point(wv, wv.offsetWidth * 0.12, -40)
    d.press(true)
    band.style.opacity = '1'
    d.cursor?.classList.add('drag')
    d.nudge(wv.offsetWidth * 0.2, 0)
    await d.anim(
      900,
      (p) => {
        band.style.width = `${p * 20}%`
      },
      outQuad,
    )
    d.press(false)
    d.cursor?.classList.remove('drag')
    $('[data-lab]', st).style.opacity = '1'
    $('[data-loops]', st).innerHTML =
      `<span>Loops</span><span class="lp loop">${ic('loop')}B part turn</span><span class="lp dim">${ic('plus')}New loop</span>`
    if (d.cursor) d.cursor.style.opacity = '0'
    for (let k = 0; k < 2; k++) await d.anim(1900, (p) => setPlayhead(62 + p * 20))
    setPlayhead(62)
  },
}

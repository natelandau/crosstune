// Lists: Forked Deer is dragged up the Saturday set list, then the list plays straight through.
import { browser, ic, kp, wRec, wSide } from './atoms'
import type { Rec } from './atoms'
import { BY_TITLE } from './data'
import { $, $$ } from './runner'
import type { DemoDef } from './types'

const SET = [
  "Soldier's Joy",
  'Kesh Jig',
  'Over the Waterfall',
  'Sail Away Ladies',
  'Forked Deer',
  'Salt Creek',
  'Cluck Old Hen',
  'Red Haired Boy',
]
/** Row height in the list, in native pixels. */
const ROW = 44

const meta = (title: string) => {
  const t = BY_TITLE[title]
  return `${kp(t.k, t.m)}<span>${
    t.k === 'G' ? 'major · Jig · 6/8 · AABB · Irish' : 'major · Reel · 2/4 · AABB · Old-time'
  }</span>`
}

const markup = () => `
  <div data-l="0" data-y="68" data-lm="-232" data-ym="40">${browser(
    1280,
    940,
    `<div class="wa">${wSide('Jalopy')}
    <div class="wc">
      <div class="w-top">${ic('plus')}${ic('more')}</div>
      <div class="wc-title">Saturday at the Jalopy</div>
      <div class="w-meta set-meta"><span>8 tunes</span><span class="play-btn" data-playbtn>${ic('play')}Play</span></div>
      <div class="set" data-list style="height:${SET.length * ROW}px">${SET.map(
        (t, i) =>
          `<div class="wr set-row" data-name="${t}" style="top:${i * ROW}px;height:${ROW}px"><span class="pos">${i + 1}</span><span class="t">${t}</span>${kp(BY_TITLE[t].k, BY_TITLE[t].m)}</div>`,
      ).join('')}</div>
    </div>
    <div class="wd">
      <div class="w-top"><span class="txt">Edit</span>${ic('more')}</div>
      <div class="wd-title" data-dt>Soldier's Joy</div>
      <div class="wd-meta" data-dm>${meta("Soldier's Joy")}</div>
      <div class="wd-sec">Recordings${ic('plus')}</div>
      <div>${(
        [
          ['mine', 'Jam at the Jalopy', '2:41 · Oct 4, 2026'],
          ['sp', "Soldier's Joy · Hollow Rock String Band", 'Spotify'],
        ] as Rec[]
      )
        .map(wRec)
        .join('')}</div>
      <div class="wd-sec">Lists${ic('plus')}</div>
      <span class="chip-l">Saturday at the Jalopy</span>
    </div>
  </div>
  <div class="np-bar" data-npbar>
    ${ic('pause')}<span class="np-t"><b data-nptitle>Soldier's Joy</b><small>Saturday at the Jalopy</small></span>
    <span class="np-track"><i data-npp></i></span>
    <span class="np-i" data-npi>1 of 8</span>
  </div>`,
    '/lists/saturday-at-the-jalopy',
  )}</div>`

export const lists: DemoDef = {
  kind: 'feat',
  h: 1040,
  hm: 1010,
  label:
    'A set list in the browser. Forked Deer is dragged up to second place, then the list plays straight through.',
  markup,
  async script(d) {
    const st = d.stage
    const list = $('[data-list]', st)
    const row = (name: string) => $(`[data-name="${name}"]`, list)
    const order = SET.slice()
    const layout = () =>
      order.forEach((t, i) => {
        const r = row(t)
        r.style.top = `${i * ROW}px`
        $('.pos', r).textContent = String(i + 1)
      })
    await d.wait(500)
    const moved = row('Forked Deer')
    await d.point(moved, -60)
    d.press(true)
    moved.classList.add('lifted')
    await d.wait(200)
    order.splice(order.indexOf('Forked Deer'), 1)
    order.splice(1, 0, 'Forked Deer')
    layout()
    d.nudge(0, -3 * ROW)
    await d.wait(600)
    d.press(false)
    moved.classList.remove('lifted')
    await d.wait(500)
    await d.click($('[data-playbtn]', st))
    $('[data-npbar]', st).classList.add('in')
    if (d.cursor) d.cursor.style.opacity = '0'
    const dot = $('[data-npp]', st)
    for (let k = 0; k < 3; k++) {
      const name = order[k]
      for (const r of $$('.wr', list)) r.classList.remove('hl')
      row(name).classList.add('hl')
      $('[data-nptitle]', st).textContent = name
      $('[data-npi]', st).textContent = `${k + 1} of 8`
      $('[data-dt]', st).textContent = name
      $('[data-dm]', st).innerHTML = meta(name)
      await d.anim(2300, (p) => {
        dot.style.left = `calc(${p * 100}% - ${p * 12}px)`
      })
    }
  },
}

// Hero: the web app filters the catalog to D while the phone plays Soldier's Joy.
import { browser, ic, kp, pRec, phone, sg, wRec, wRow, wSide } from './atoms'
import type { Rec } from './atoms'
import { TUNES } from './data'
import { $, $$ } from './runner'
import type { DemoDef } from './types'

const KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F', 'Bb', 'Eb', 'Ab', 'F#', 'C#']

const markup = () => `
  <div data-l="0" data-y="56" data-lm="-232" data-ym="56">${browser(
    1240,
    960,
    `<div class="wa">${wSide('Catalog')}
    <div class="wc">
      <div class="w-top">${ic('plus')}${ic('more')}</div>
      <div class="wc-title">Catalog</div>
      <div class="w-search">${ic('search')}Search tunes</div>
      <div class="w-chips">
        <span class="w-chip">Status: Any ${ic('down', 'i dn')}</span>
        <span class="w-chip" data-keychip><span data-keylabel>Key: Any</span> ${ic('down', 'i dn')}${ic('x', 'i x')}</span>
        <span class="w-chip">${ic('sliders')}Filters</span>
        <div class="pop" data-pop style="left:92px">${KEYS.map((k) => kp(k)).join('')}</div>
      </div>
      <div class="w-meta"><span data-count>148 tunes</span><span class="sort">Title ${ic('up')}</span></div>
      <div class="rows" data-rows>${TUNES.map((t) => wRow(t)).join('')}</div>
    </div>
    <div class="wd">
      <div class="w-top"><span class="txt">Edit</span>${ic('more')}</div>
      <div class="wd-title">Over the Waterfall</div>
      <div class="wd-meta">${kp('D')}<span>major · Reel · 2/4 · AABB · Old-time</span></div>
      <div class="wd-meta">${sg('known')}<span>Known</span><span class="m2">· Violin: Standard (GDAE)</span></div>
      <div class="wd-sec">Recordings${ic('plus')}</div>
      ${(
        [
          ['mine', 'Saturday session', '0:45 · Sep 20, 2026'],
          ['sp', 'Over the Waterfall · Hollow Rock String Band', 'Spotify'],
          ['yt', 'Over the Waterfall at the Clifftop porch', 'YouTube'],
        ] as Rec[]
      )
        .map(wRec)
        .join('')}
      <div class="wd-sec">Scans${ic('plus')}</div>
      <div class="wd-sec">Lyrics${ic('plus')}</div>
      <div class="wd-sec">Lists${ic('plus')}</div>
      <span class="chip-l">Saturday at the Jalopy</span>
    </div>
  </div>`,
    '/catalog',
  )}</div>
  <div class="ph" data-l="1130" data-y="84" data-lm="150" data-ym="176">${phone(
    `
      <div class="ph-nav"><span class="ph-btn">${ic('left')}</span><span class="ph-btn">${ic('more')}</span></div>
      <div class="ph-title">Soldier's Joy</div>
      <div class="ph-meta2">${kp('D')}<span>major · Reel · AABB</span></div>
      <div class="ph-meta2">${sg('known')}<span class="b">Known</span></div>
      <div class="ph-sec">Recordings${ic('plus')}</div>
      ${(
        [
          ['mine', 'Jam at the Jalopy', '2:41 · Oct 4, 2026'],
          ['sp', 'Hollow Rock String Band', 'Spotify'],
          ['yt', "Soldier's Joy, slow", 'YouTube'],
        ] as Rec[]
      )
        .map(pRec)
        .join('')}
      <div class="ph-sec">Learned from</div>
      <div class="ph-note">Rhys at the Brooklyn jam, March 2025</div>`,
    {
      tab: 0,
      extra: `<div class="ph-np"><span class="svc sp">S</span><span><b>Soldier's Joy</b><small>Hollow Rock String Band</small></span><span class="pp">${ic('pause')}</span><div class="bar"><i></i></div></div>`,
    },
  )}</div>`

export const hero: DemoDef = {
  kind: 'hero',
  h: 960,
  hm: 1050,
  cw: 1520,
  label:
    "Crosstune in a web browser and on an iPhone. In the browser, the catalog is filtered to tunes in D. The iPhone plays Soldier's Joy.",
  markup,
  async script(d) {
    const st = d.stage
    const chip = $('[data-keychip]', st)
    const pop = $('[data-pop]', st)
    await d.wait(600)
    await d.click(chip)
    pop.classList.add('open')
    await d.wait(500)
    const pickD = $$('.kp', pop)[2]
    await d.point(pickD)
    pickD.classList.add('pick')
    d.press(true)
    await d.wait(160)
    d.press(false)
    pop.classList.remove('open')
    chip.classList.add('on')
    $('[data-keylabel]', st).textContent = 'Key: D'
    const rows = $$('.wr', $('[data-rows]', st))
    for (const r of rows) {
      if (r.dataset.key !== 'D') {
        r.classList.add('gone')
        await d.wait(45)
      }
    }
    $('[data-count]', st).textContent = '41 tunes'
    d.nudge(160, 220)
    await d.wait(3200)
    if (d.instant) return
    await d.click($('.x', chip))
    chip.classList.remove('on')
    $('[data-keylabel]', st).textContent = 'Key: Any'
    for (const r of rows) r.classList.remove('gone')
    $('[data-count]', st).textContent = '148 tunes'
    await d.wait(1200)
  },
}

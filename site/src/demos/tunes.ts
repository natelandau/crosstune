// Tunes: the browser shows the Learning list while a search for "jig" narrows the phone catalog.
import { browser, ic, kp, phone, pRow, sg, wRec, wRow, wSide } from './atoms'
import type { Rec } from './atoms'
import { JIGS, LEARN } from './data'
import { $, $$ } from './runner'
import type { DemoDef } from './types'

const markup = () => `
  <div data-l="0" data-y="68" data-hidem>${browser(
    1280,
    1000,
    `<div class="wa">${wSide('Learning')}
    <div class="wc">
      <div class="w-top">${ic('plus')}${ic('more')}</div>
      <div class="wc-title">Learning</div>
      <div class="w-search">${ic('search')}Search tunes</div>
      <div class="w-chips"><span class="w-chip">Key: Any ${ic('down')}</span><span class="w-chip">${ic('sliders')}Filters</span></div>
      <div class="w-meta"><span>23 tunes</span><span class="sort">Title ${ic('up')}</span></div>
      <div class="rows">${LEARN.map((t) => wRow(t)).join('')}</div>
    </div>
    <div class="wd">
      <div class="w-top"><span class="txt">Edit</span>${ic('more')}</div>
      <div class="wd-title">Elzic's Farewell</div>
      <div class="wd-meta">${kp('A', 'dor')}<span>Reel · AABB · Old-time</span></div>
      <div class="wd-meta">${sg('learning')}<span>Learning</span><span class="m2">· Violin: Cross A (AEAE)</span></div>
      <div class="wd-sec">Recordings${ic('plus')}</div>
      ${(
        [
          ['mine', 'Porch at Clifftop', '1:12 · Aug 6, 2026'],
          ['sp', "Elzic's Farewell · Bruce Molsky", 'Spotify'],
        ] as Rec[]
      )
        .map(wRec)
        .join('')}
    </div>
  </div>`,
    '/learning',
  )}</div>
  <div class="ph" data-r="56" data-y="124" data-cm data-ym="66">${phone(
    `
      <div class="ph-nav"><span></span><span class="ph-btn">${ic('plus')}</span></div>
      <div class="ph-lt">Catalog ${ic('down')}</div>
      <div class="ph-search" data-s>${ic('search')}<span class="ph-ph">Search tunes</span><span class="q" data-q></span><span class="caret"></span></div>
      <div class="ph-chips"><span class="ph-chip">Status ${ic('down')}</span><span class="ph-chip">Key ${ic('down')}</span><span class="ph-chip">${ic('sliders')}Filters</span></div>
      <div class="ph-meta"><span data-count>148 tunes</span><span class="sort">Title ${ic('up')}</span></div>
      <div class="rows" data-rows>${JIGS.map(pRow).join('')}</div>`,
    { tab: 0 },
  )}</div>`

export const tunes: DemoDef = {
  kind: 'feat',
  h: 1040,
  hm: 966,
  label:
    'The browser shows the tunes you are learning. On the iPhone, typing jig in search narrows the catalog to jigs.',
  markup,
  async script(d) {
    const st = d.stage
    const search = $('[data-s]', st)
    const q = $('[data-q]', st)
    const hint = $('.ph-ph', search)
    const rows = $$('[data-rows] .pr', st)
    const count = $('[data-count]', st)
    const matches = (v: string) => rows.filter((r) => r.dataset.t?.includes(v))
    await d.wait(500)
    await d.tap(search)
    search.classList.add('focus')
    hint.hidden = true
    await d.type(q, 'jig', 300, (v) => {
      for (const r of rows) r.classList.toggle('gone', !r.dataset.t?.includes(v))
      count.textContent = `${matches(v).length + (v.length < 3 ? 40 : 1)} tunes`
    })
    count.textContent = '4 tunes'
    await d.wait(2600)
    if (d.instant) return
    q.textContent = ''
    hint.hidden = false
    search.classList.remove('focus')
    for (const r of rows) r.classList.remove('gone')
    count.textContent = '148 tunes'
    await d.wait(900)
  },
}

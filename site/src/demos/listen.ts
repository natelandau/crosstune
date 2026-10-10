// Listen: on the phone, a search finds versions of Sail Away Ladies; the Slippery-Hill one is
// added and downloaded, then appears on the tune in the browser.
import { browser, ic, kp, phone, pRec, sg, wRec, wRow, wSide } from './atoms'
import type { Rec } from './atoms'
import { LEARN } from './data'
import { $ } from './runner'
import type { DemoDef } from './types'

/** Search results: service class, badge letter, title, service, and whether it is on the tune. */
const RESULTS: [string, string, string, string, boolean][] = [
  ['sp', 'S', 'Uncle Bunt Stephens', 'Spotify', true],
  ['yt', '▶', 'Old-time fiddle lesson', 'YouTube', false],
  ['am', 'A', 'Old Crow Medicine Show', 'Apple Music', false],
  ['sh', 'SH', 'Field recording, 1937', 'Slippery-Hill', false],
  ['bc', 'B', 'The Onlies', 'Bandcamp', true],
]

const markup = () => `
  <div data-r="0" data-y="68" data-hidem>${browser(
    1180,
    1000,
    `<div class="wa">${wSide('Learning')}
    <div class="wc">
      <div class="w-top">${ic('plus')}${ic('more')}</div>
      <div class="wc-title">Learning</div>
      <div class="w-search">${ic('search')}Search tunes</div>
      <div class="w-meta w-meta-gap"><span>23 tunes</span><span class="sort">Title ${ic('up')}</span></div>
      <div class="rows">${LEARN.map((t) => wRow(t, t.t === 'Sail Away Ladies')).join('')}</div>
    </div>
    <div class="wd">
      <div class="w-top"><span class="txt">Edit</span>${ic('more')}</div>
      <div class="wd-title">Sail Away Ladies</div>
      <div class="wd-meta">${kp('D')}<span>major · Reel · 2/4 · AABB · Old-time</span></div>
      <div class="wd-meta">${sg('learning')}<span>Learning</span></div>
      <div class="wd-sec">Recordings${ic('plus')}</div>
      ${(
        [
          ['mine', 'Front porch, slow', '1:04 · Sep 2, 2026'],
          ['sp', 'Sail Away Ladies · Uncle Bunt Stephens', 'Spotify'],
          ['bc', 'Sail Away Ladies · The Onlies', 'Bandcamp'],
        ] as Rec[]
      )
        .map(wRec)
        .join('')}
      <div class="grow" data-wnew><div class="wrec" data-wnewrow><span class="pl">${ic('play')}</span><span><b>Sail Away Ladies, field recording</b><small>Slippery-Hill · Saved offline</small></span></div></div>
    </div>
  </div>`,
    '/tunes/sail-away-ladies',
  )}</div>
  <div class="ph" data-l="36" data-y="124" data-cm data-ym="66">${phone(
    `
      <div class="ph-nav"><span class="ph-btn">${ic('left')}</span><span class="ph-btn">${ic('more')}</span></div>
      <div class="ph-title">Sail Away Ladies</div>
      <div class="ph-meta2">${kp('D')}<span>Reel · AABB</span></div>
      <div class="ph-meta2">${sg('learning')}<span class="b">Learning</span></div>
      <div class="ph-sec">Recordings<span class="find" data-find>${ic('search')}Find</span></div>
      ${(
        [
          ['mine', 'Front porch, slow', '1:04 · Sep 2, 2026'],
          ['sp', 'Uncle Bunt Stephens', 'Spotify'],
          ['bc', 'The Onlies', 'Bandcamp'],
        ] as Rec[]
      )
        .map(pRec)
        .join('')}
      <div class="grow" data-pnew><div class="prec"><span class="pl">${ic('play')}</span><span><b>Field recording</b><small class="lk" data-dlstate>Slippery-Hill</small></span><span class="end dl" data-dl>${ic('download')}</span></div></div>`,
    {
      tab: 0,
      extra: `<div class="scrim" data-scrim></div>
      <div class="sheet find-sheet" data-sheet>
        <div class="grab"></div>
        <div class="ph-search">${ic('search')}<span class="q">Sail Away Ladies</span></div>
        <div class="find-chips"><span class="ph-chip on">All</span><span class="ph-chip">Spotify</span><span class="ph-chip">YouTube</span><span class="ph-chip">Apple Music</span></div>
        ${RESULTS.map(
          ([c, l, t, s, added]) =>
            `<div class="prec"${c === 'sh' ? ' data-sh' : ''}><span class="svc ${c}">${l}</span><span><b>${t}</b><small>${s}</small></span><span class="addbtn${added ? ' added' : ''}">${ic(added ? 'check' : 'plus')}</span></div>`,
        ).join('')}
      </div>`,
    },
  )}</div>`

export const listen: DemoDef = {
  kind: 'feat',
  h: 1040,
  hm: 966,
  label:
    'On the iPhone, a search for Sail Away Ladies finds versions on several services. The Slippery-Hill version is added and downloaded, and it appears on the tune in the browser.',
  markup,
  async script(d) {
    const st = d.stage
    const sheet = $('[data-sheet]', st)
    const scrim = $('[data-scrim]', st)
    await d.wait(600)
    await d.tap($('[data-find]', st))
    scrim.classList.add('on')
    sheet.classList.add('open')
    await d.wait(1100)
    const add = $('[data-sh] .addbtn', st)
    await d.tap(add)
    add.classList.add('added')
    add.innerHTML = ic('check')
    await d.wait(800)
    sheet.classList.remove('open')
    scrim.classList.remove('on')
    await d.wait(500)
    $('[data-pnew]', st).classList.add('in')
    await d.wait(900)
    const dl = $('[data-dl]', st)
    await d.tap(dl)
    dl.innerHTML =
      '<svg class="ring" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle data-ring cx="12" cy="12" r="9"/></svg>'
    const ring = $<SVGCircleElement>('[data-ring]', dl)
    await d.anim(1500, (p) => ring.setAttribute('stroke-dashoffset', String(56.5 * (1 - p))))
    dl.innerHTML = ic('check2', 'i ok')
    $('[data-dlstate]', st).textContent = 'Slippery-Hill · Saved offline'
    await d.wait(500)
    $('[data-wnew]', st).classList.add('in')
    const row = $('[data-wnewrow]', st)
    row.classList.add('hl')
    await d.wait(1400)
    row.classList.remove('hl')
    await d.wait(1200)
  },
}

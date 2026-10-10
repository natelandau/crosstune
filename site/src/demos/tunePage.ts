// Tune page: Cluck Old Hen with its recordings, scans, and details; the phone opens its lyrics
// full screen and steps through the lines.
import {
  browser,
  ic,
  kp,
  phone,
  pRec,
  scanChord,
  scanNote,
  scanSheet,
  sg,
  wRec,
  wRow,
  wSide,
} from './atoms'
import type { Rec } from './atoms'
import { TUNES } from './data'
import { $, $$ } from './runner'
import type { DemoDef } from './types'

const LYRICS = [
  'My old hen’s a good old hen,',
  'she lays eggs for the railroad men.',
  'Sometimes one, sometimes two,',
  'sometimes enough for the whole darn crew.',
  '',
  'Cluck old hen, cluck and sing,',
  'ain’t laid an egg since way last spring.',
  'Cluck old hen, cluck and squall,',
  'ain’t laid an egg since way last fall.',
]

const scans = `<div class="scan">${scanSheet}</div><div class="scan">${scanNote}</div><div class="scan">${scanChord}</div>`

const markup = () => `
  <div data-r="0" data-y="68" data-hidem>${browser(
    1180,
    1000,
    `<div class="wa">${wSide('Known')}
    <div class="wc">
      <div class="w-top">${ic('plus')}${ic('more')}</div>
      <div class="wc-title">Known</div>
      <div class="w-search">${ic('search')}Search tunes</div>
      <div class="w-meta w-meta-gap"><span>62 tunes</span><span class="sort">Title ${ic('up')}</span></div>
      <div class="rows">${TUNES.filter((t) => t.s === 'known')
        .map((t) => wRow(t, t.t === 'Cluck Old Hen'))
        .join('')}</div>
    </div>
    <div class="wd">
      <div class="w-top"><span class="txt">Edit</span>${ic('more')}</div>
      <div class="wd-title">Cluck Old Hen</div>
      <div class="wd-meta">${kp('A')}<span>major · Breakdown · 2/4 · AABB · Old-time</span></div>
      <div class="wd-meta">${sg('known')}<span>Known</span><span class="m2">· Violin: Cross A (AEAE)</span></div>
      <div class="wd-sec">Recordings${ic('plus')}</div>
      ${(
        [
          ['mine', 'Front porch, Clifftop', '1:58 · Aug 6, 2026'],
          ['am', 'Cluck Old Hen · Hobart Smith', 'Apple Music'],
        ] as Rec[]
      )
        .map(wRec)
        .join('')}
      <div class="wd-sec">Scans${ic('plus')}</div>
      <div class="scans">${scans}</div>
      <div class="wd-sec">Details${ic('right')}</div>
      <div class="wfield"><span>Learned from</span><span>Jo at the Clifftop camp</span><span>When</span><span>August 2025</span></div>
    </div>
  </div>`,
    '/tunes/cluck-old-hen',
  )}</div>
  <div class="ph" data-l="36" data-y="124" data-cm data-ym="66">${phone(
    `
      <div class="view" data-v1>
        <div class="ph-nav"><span class="ph-btn">${ic('left')}</span><span class="ph-btn">${ic('more')}</span></div>
        <div class="ph-title">Cluck Old Hen</div>
        <div class="ph-meta2">${kp('A')}<span>Breakdown · AABB</span></div>
        <div class="ph-meta2">${sg('known')}<span class="b">Known</span><span>· AEAE</span></div>
        <div class="ph-sec">Recordings${ic('plus')}</div>
        ${(
          [
            ['mine', 'Front porch, Clifftop', '1:58 · Aug 6, 2026'],
            ['am', 'Hobart Smith', 'Apple Music'],
          ] as Rec[]
        )
          .map(pRec)
          .join('')}
        <div class="ph-sec">Scans${ic('plus')}</div>
        <div class="scans sm">${scans}</div>
        <div class="ph-sec" data-lyr>Lyrics${ic('right')}</div>
        <div class="ph-note">My old hen’s a good old hen…</div>
      </div>
      <div class="view lyrics" data-v2>
        <div class="lyr-bar"><span class="ph-badge awake">${ic('sun')}Screen stays awake</span><span class="done" data-done>Done</span></div>
        <div class="lyr-lines" data-lines>${LYRICS.map((l) => `<div>${l}</div>`).join('')}</div>
      </div>`,
    { bodyStyle: 'padding:0' },
  )}</div>`

export const tunePage: DemoDef = {
  kind: 'feat',
  h: 1040,
  hm: 966,
  label:
    'The tune page for Cluck Old Hen in a browser, with recordings, scans, lyrics, and details. On the iPhone, the lyrics open full screen.',
  markup,
  async script(d) {
    const st = d.stage
    const v1 = $('[data-v1]', st)
    const v2 = $('[data-v2]', st)
    const wrap = $('[data-lines]', st)
    const lines = $$(':scope > div', wrap)
    await d.wait(900)
    await d.tap($('[data-lyr]', st))
    v1.style.transform = 'translateX(-30%)'
    v2.style.transform = 'none'
    await d.wait(600)
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].textContent) continue
      lines.forEach((l, j) => {
        l.className = j === i ? 'now' : j < i ? 'past' : ''
      })
      if (i > 4) wrap.style.transform = `translateY(-${(i - 4) * 33}px)`
      await d.wait(1050)
    }
    if (d.instant) return
    await d.wait(600)
    await d.tap($('[data-done]', st))
    v1.style.transform = 'none'
    v2.style.transform = 'translateX(100%)'
    await d.wait(900)
  },
}

// Folk: with no signal, the phone marks Lost Indian as crooked; when the signal returns the change
// syncs and the browser shows it.
import { battery, browser, ic, kp, phone, signal, sg, wRow, wSide } from './atoms'
import { LEARN } from './data'
import { $ } from './runner'
import type { DemoDef } from './types'

const field = ([k, v]: [string, string]) =>
  `<div class="prec field"><span>${k}</span><span class="v">${v}</span></div>`

const markup = () => `
  <div data-l="0" data-y="68" data-hidem>${browser(
    1280,
    1000,
    `<div class="wa">${wSide('Learning')}
    <div class="wc">
      <div class="w-top">${ic('plus')}${ic('more')}</div>
      <div class="wc-title">Learning</div>
      <div class="rows rows-gap">${LEARN.map((t) => wRow(t, t.t === 'Lost Indian')).join('')}</div>
    </div>
    <div class="wd">
      <div class="w-top"><span class="txt">Edit</span>${ic('more')}</div>
      <div class="wd-title">Lost Indian</div>
      <div class="wd-meta">${kp('A', 'mix')}<span>Mixolydian · Reel · 2/4</span></div>
      <div class="wd-meta">${sg('learning')}<span>Learning</span></div>
      <div class="wd-sec">Details</div>
      <div class="wfield">
        <span>Violin</span><span>Cross A (AEAE)</span>
        <span>Banjo</span><span>Open A (aEAC♯E)</span>
        <span>Structure</span><span>AABB</span>
        <span>Crooked</span><span class="flash" data-mcrook>No</span>
        <span>Feel</span><span>Driving</span>
        <span>Learned from</span><span>Ezra, Clifftop campground</span>
      </div>
    </div>
  </div>`,
    '/tunes/lost-indian',
  )}</div>
  <div class="ph" data-l="44" data-y="124" data-cm data-ym="66">${phone(
    `
      <div class="ph-nav"><span class="ph-btn">${ic('left')}</span><span class="ph-badge" data-badge>${ic('wifioff')}Offline</span></div>
      <div class="ph-title">Lost Indian</div>
      <div class="ph-meta2">${kp('A', 'mix')}<span>Reel · 2/4</span></div>
      <div class="ph-sec">Details</div>
      ${(
        [
          ['Violin', 'AEAE'],
          ['Banjo', 'aEAC♯E'],
          ['Structure', 'AABB'],
        ] as [string, string][]
      )
        .map(field)
        .join('')}
      <div class="prec field tall"><span>Crooked</span><span class="tog" data-tog><i></i></span></div>
      ${(
        [
          ['Feel', 'Driving'],
          ['Learned from', 'Ezra'],
        ] as [string, string][]
      )
        .map(field)
        .join('')}`,
    { on: false },
  )}</div>`

export const folk: DemoDef = {
  kind: 'feat',
  h: 1040,
  hm: 966,
  label:
    'With no signal, the iPhone marks Lost Indian as crooked. When the signal returns, the change syncs and the browser shows it.',
  markup,
  async script(d) {
    const st = d.stage
    const tog = $('[data-tog]', st)
    const badge = $('[data-badge]', st)
    await d.wait(900)
    await d.tap(tog)
    tog.classList.add('on')
    await d.wait(1600)
    $('[data-sig]', st).innerHTML = `${signal(true)}${battery}`
    badge.innerHTML = `${ic('sync')}Syncing`
    await d.wait(1100)
    badge.innerHTML = `${ic('check2', 'i ok')}Synced`
    const crooked = $('[data-mcrook]', st)
    crooked.textContent = 'Yes'
    crooked.classList.add('on')
    await d.wait(1800)
    crooked.classList.remove('on')
    await d.wait(1200)
  },
}

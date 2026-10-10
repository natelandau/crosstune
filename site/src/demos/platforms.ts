// Platforms: the same catalog on a Mac, in a browser, on an iPad, and on an iPhone, all to scale.
// Light hardware around the Mac and the iPad keeps the two from reading as the same device.
import {
  battery,
  browser,
  ic,
  kp,
  phone,
  pRec,
  pRow,
  scanNote,
  scanSheet,
  sg,
  signal,
  wRec,
  wRow,
  wSide,
} from './atoms'
import type { Rec } from './atoms'
import { TUNES } from './data'
import type { DemoDef } from './types'

const macSide = `<aside class="ms"><div class="lights"><i></i><i></i><i></i></div>
  <div class="ws-i sel">${ic('music')}Catalog<span class="n">148</span></div>
  <div class="ws-i sub">${sg('known')}Known<span class="n">62</span></div>
  <div class="ws-i sub">${sg('learning')}Learning<span class="n">23</span></div>
  <div class="ws-i sub">${sg('unknown')}Unknown<span class="n">63</span></div>
  <div class="ws-i">${ic('wave')}Recordings</div>
  <div class="ws-h">Lists</div>
  <div class="ws-i">Saturday at the Jalopy</div><div class="ws-i">Clifftop 2026</div></aside>`

const markup = () => `
  <div data-l="1150" data-y="40" data-hidem>${browser(
    1200,
    760,
    `<div class="wa">${wSide('Catalog')}<div class="wc"><div class="w-top">${ic('plus')}</div><div class="wc-title">Catalog</div><div class="rows">${TUNES.slice(
      0,
      13,
    )
      .map((t) => wRow(t))
      .join(
        '',
      )}</div></div><div class="wd"><div class="wd-title plat-wd">Kesh Jig</div><div class="wd-meta">${kp('G')}<span>major · Jig · 6/8 · Irish</span></div></div></div>`,
    '/catalog',
  )}</div>
  <div class="hw-lap" data-l="20" data-y="150" data-hidem><div class="hw-lid"><div class="hw-scr">
    <div class="hw-menu"><b>Crosstune</b><span>File</span><span>Edit</span><span>View</span><span>Window</span><span>Help</span><span class="r">Thu Oct 9  9:41 AM</span></div>
    <div class="mw">${macSide}
      <div class="mc"><div class="mc-title">Catalog</div><div class="rows">${TUNES.slice(0, 15)
        .map((t) => wRow(t))
        .join('')}</div></div>
      <div class="mc mc-detail"><div class="mc-tune">Soldier's Joy</div><div class="wd-meta">${kp('D')}<span>major · Reel · 2/4 · AABB</span></div><div class="wd-sec">Recordings</div>${(
        [
          ['mine', 'Jam at the Jalopy', '2:41'],
          ['sp', 'Hollow Rock String Band', 'Spotify'],
        ] as Rec[]
      )
        .map(wRec)
        .join('')}</div>
    </div></div></div><div class="hw-base"></div></div>
  <div class="hw-pad" data-l="980" data-y="600" data-lm="-660" data-ym="80"><div class="ipad">
    <div class="ipad-st"><span>9:41  Thu Oct 9</span><span class="sig">${signal(true)}${battery}</span></div>
    <aside class="is"><div class="ws-i sel">${ic('music')}Catalog<span class="n">148</span></div><div class="ws-i sub">${sg('known')}Known</div><div class="ws-i sub">${sg('learning')}Learning</div><div class="ws-i sub">${sg('unknown')}Unknown</div><div class="ws-i">${ic('wave')}Recordings</div><div class="ws-h">Lists</div><div class="ws-i">Saturday at the Jalopy</div><div class="ws-i">Clifftop 2026</div></aside>
    <div class="ic"><div class="ph-lt">Catalog</div><div class="rows">${TUNES.slice(2, 13).map(pRow).join('')}</div></div>
    <div class="ipad-detail"><div class="ph-title">Cluck Old Hen</div><div class="ph-meta2">${kp('A')}<span>Breakdown · AABB</span></div><div class="ph-sec">Recordings</div>${(
      [
        ['mine', 'Front porch, Clifftop', '1:58'],
        ['am', 'Hobart Smith', 'Apple Music'],
      ] as Rec[]
    )
      .map(pRec)
      .join(
        '',
      )}<div class="ph-sec">Scans</div><div class="scans"><div class="scan">${scanSheet}</div><div class="scan">${scanNote}</div></div></div>
  </div></div>
  <div class="hw-phone" data-l="1940" data-y="640" data-lm="470" data-ym="150"><div class="ph">${phone(
    `<div class="ph-nav"><span></span><span class="ph-btn">${ic('plus')}</span></div><div class="ph-lt">Catalog ${ic('down')}</div><div class="ph-search">${ic('search')}Search tunes</div><div class="rows rows-tight">${TUNES.slice(4, 15).map(pRow).join('')}</div>`,
    { tab: 0 },
  )}</div></div>`

export const platforms: DemoDef = {
  kind: 'plat',
  h: 1560,
  hm: 1080,
  cw: 2380,
  label:
    'Crosstune on a Mac, in a web browser, on an iPad, and on an iPhone, showing the same catalog.',
  markup,
}

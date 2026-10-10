// Record: one tap on the phone records at the Jalopy, files the take under Morrison's Jig with a
// note, and the new recording lands in the list.
import { ic, phone } from './atoms'
import { $ } from './runner'
import type { DemoDef } from './types'

const recRow = (title: string, sub: string, tune = '') =>
  `<div class="prec"><span class="pl">${ic('play')}</span><span><b>${title}</b><small>${sub}</small>${
    tune ? `<small class="lk">${tune} ›</small>` : ''
  }</span></div>`

const markup = () => `
  <div class="ph" data-c data-y="60" data-ym="62">${phone(
    `
      <div class="ph-nav"><span></span><span class="ph-btn">${ic('plus')}</span></div>
      <div class="ph-lt">Recordings</div>
      <div class="ph-search">${ic('search')}Search recordings</div>
      <div class="ph-meta rec-meta"><span>5 recordings</span><span class="sort">Date added ↓</span></div>
      <div class="ph-sec rec-group first">Unfiled</div>
      ${recRow('Recording, Sep 24 at 6:30 PM', '0:45 · Added Sep 24, 2026')}
      <div class="ph-sec rec-group">Filed</div>
      <div class="rec-new" data-new><div>${recRow('B part from the fiddler', '0:14 · Added today · Synced', "Morrison's Jig")}</div></div>
      ${recRow('Saturday session', '0:45 · Added Sep 20, 2026', 'Backstep Cindy')}
      ${recRow('With the band', '0:30 · Added Sep 13, 2026', 'Bibb County Hoedown')}
      ${recRow('Joe at Clifftop', '0:45 · Added Aug 6, 2026', 'Sail Away Ladies')}`,
    {
      tab: 2,
      extra: `<div class="scrim" data-scrim></div>
      <div class="sheet rec-sheet" data-rec>
        <div class="grab"></div>
        <div class="rec-where">${ic('pin')}Jalopy Theatre</div>
        <div class="rec-time" data-time>0:00</div>
        <div class="wave rec-wave" data-wave></div>
        <div class="rec-stop" data-stop><i></i></div>
      </div>
      <div class="sheet save-sheet" data-save>
        <div class="grab"></div>
        <div class="save-title">Save recording</div>
        <div class="prec" data-tune><span class="pl">${ic('music')}</span><span><b data-tunename>Unfiled</b><small>Tune</small></span>${ic('down')}</div>
        <div class="prec"><span class="pl">${ic('text')}</span><span><b class="note" data-note></b><small>Note</small></span></div>
        <div class="prec last"><span class="pl">${ic('pin')}</span><span><b>Jalopy Theatre</b><small>0:14, today at 9:41 PM</small></span></div>
        <div class="save-btn" data-savebtn>Save</div>
      </div>`,
    },
  )}</div>`

export const record: DemoDef = {
  kind: 'tall',
  h: 964,
  hm: 966,
  label:
    "On the iPhone, one tap starts a recording at the Jalopy Theatre. It is filed under Morrison's Jig with a note and appears in Recordings.",
  markup,
  async script(d) {
    const st = d.stage
    const rec = $('[data-rec]', st)
    const save = $('[data-save]', st)
    const scrim = $('[data-scrim]', st)
    const bars = $('[data-wave]', st)
    const time = $('[data-time]', st)
    await d.wait(700)
    await d.tap($('[data-disc]', st))
    scrim.classList.add('on')
    rec.classList.add('open')
    await d.wait(500)
    let n = 0
    for (let sec = 0; sec <= 14; sec++) {
      time.textContent = `0:${String(sec).padStart(2, '0')}`
      for (let k = 0; k < 4; k++) {
        const bar = document.createElement('i')
        bar.style.height = `${14 + Math.abs(Math.sin(n * 0.7) * Math.cos(n * 0.23)) * 130}px`
        bars.appendChild(bar)
        n++
        if (bars.children.length > 50) bars.firstElementChild?.remove()
        await d.wait(55)
      }
    }
    await d.tap($('[data-stop]', st))
    rec.classList.remove('open')
    save.classList.add('open')
    await d.wait(700)
    await d.tap($('[data-tune]', st))
    $('[data-tunename]', st).textContent = "Morrison's Jig"
    await d.wait(500)
    await d.type($('[data-note]', st), 'B part from the fiddler', 50)
    await d.wait(500)
    await d.tap($('[data-savebtn]', st))
    save.classList.remove('open')
    scrim.classList.remove('on')
    await d.wait(700)
    $('[data-new]', st).classList.add('in')
    await d.wait(2600)
  },
}

// HTML string builders for the recreated app screens. Pure functions, so Astro renders a demo's
// first frame at build time and the client rebuilds the same markup each time a demo loops.

export type Status = 'known' | 'learning' | 'unknown'

/** A tune as a row shows it: title, key, mode, status, and an optional tuning note. */
export type Tune = { t: string; k: string; m?: string; s: Status; tu?: string }

/** A recording row: `mine` for the player's own take, otherwise a linked service. */
export type Rec = [kind: string, title: string, sub: string]

/** Semitones above C, which picks the key pill's hue. */
export const PITCH: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  G: 7,
  Ab: 8,
  A: 9,
  Bb: 10,
  B: 11,
}

/** An icon from the page's sprite (`Icons.astro`). */
export const ic = (name: string, cls = 'i') =>
  `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`

/** A key as a colored pill. `extra` adds classes or, after a closing quote, attributes. */
export const kp = (key: string, mode = '', extra = '') =>
  `<span class="kp k${PITCH[key]} ${extra}">${key}${mode ? ' ' + mode : ''}</span>`

/** A status glyph: a check for known, half fill for learning, a ring for unknown. */
export const sg = (s: Status) =>
  `<span class="sg ${s}">${s === 'known' ? ic('check', '') : ''}</span>`

/** Waveform bars with a fixed shape for a seed, so every build draws the same recording. */
export function wave(n: number, seed: number, h: number, min = 4): string {
  let out = ''
  for (let i = 0; i < n; i++) {
    const v =
      0.25 +
      0.75 *
        Math.abs(Math.sin(i * 0.37 + seed) * Math.cos(i * 0.11 + seed * 2)) *
        (0.72 + 0.28 * Math.sin(i * 1.7))
    out += `<i style="height:${Math.max(min, Math.round(v * h))}px"></i>`
  }
  return out
}

// Status-bar glyphs are drawn device chrome, kept in the sprite beside the icons.
export const signal = (on = true) =>
  on
    ? '<svg viewBox="0 0 18 11" style="width:19px;height:12px" aria-hidden="true"><use href="#i-signal"/></svg>'
    : '<svg viewBox="0 0 24 24" style="width:18px;height:18px" aria-hidden="true"><use href="#i-wifioff"/></svg>'
export const battery =
  '<svg viewBox="0 0 26 12" style="width:27px;height:13px" aria-hidden="true"><use href="#i-battery"/></svg>'

const phStatus = (on = true) =>
  `<div class="ph-st"><span>9:41</span><span class="sig" data-sig>${signal(on)}${battery}</span></div>`

const TABS: [string, string][] = [
  ['music', 'Catalog'],
  ['list', 'Lists'],
  ['wave', 'Recordings'],
  ['gear', 'Settings'],
]
const phTab = (on = 0) =>
  `<div class="ph-tab"><div class="ph-tabcap">${TABS.map(
    ([n, l], i) => `<span class="${i === on ? 'on' : ''}">${ic(n)}${l}</span>`,
  ).join('')}</div><div class="ph-disc" data-disc><i></i></div></div>`

type PhoneOpts = {
  /** The selected tab, or -1 for a screen without the tab bar. */
  tab?: number
  /** Whether the status bar shows signal. */
  on?: boolean
  /** Layers above the screen body: sheets, a scrim, the now-playing bar. */
  extra?: string
  /** Inline style for the screen body, for screens that lay out their own padding. */
  bodyStyle?: string
}

/** An iPhone screen's contents at native size, 390 by 844. The caller supplies the `.ph` root. */
export const phone = (
  inner: string,
  { tab = -1, on = true, extra = '', bodyStyle = '' }: PhoneOpts = {},
) =>
  `${phStatus(on)}<div class="ph-body"${bodyStyle ? ` style="${bodyStyle}"` : ''}>${inner}</div>${
    tab >= 0 ? phTab(tab) : ''
  }${extra}<div class="ph-home"></div>`

/** A phone catalog row. */
export const pRow = (t: Tune) =>
  `<div class="pr" data-key="${t.k}" data-t="${t.t.toLowerCase()}">${sg(t.s)}<span class="t">${t.t}</span><span class="tu">${t.tu ?? ''}</span>${kp(t.k, t.m)}</div>`

/** A web catalog row; `hl` marks the selected tune. */
export const wRow = (t: Tune, hl = false) =>
  `<div class="wr${hl ? ' hl' : ''}" data-key="${t.k}" data-t="${t.t.toLowerCase()}" data-name="${t.t}">${sg(t.s)}<span class="t">${t.t}</span><span class="tu">${t.tu ?? ''}</span>${kp(t.k, t.m)}</div>`

const chrome = (path = '') =>
  `<div class="bw-bar"><div class="lights"><i></i><i></i><i></i></div>${ic('sidebar')}${ic('left')}${ic('right')}<div class="bw-url">${ic('lock')}my.crosstune.app${path}</div>${ic('share')}${ic('plus')}${ic('tabs')}</div>`

/** The web app's sidebar with one row selected. */
export const wSide = (sel = 'Catalog') => `<aside class="ws">
    <div class="ws-i ${sel === 'Catalog' ? 'sel' : ''}">${ic('music')}Catalog<span class="n">148</span></div>
    <div class="ws-i sub ${sel === 'Known' ? 'sel' : ''}">${sg('known')}Known<span class="n">62</span></div>
    <div class="ws-i sub ${sel === 'Learning' ? 'sel' : ''}">${sg('learning')}Learning<span class="n">23</span></div>
    <div class="ws-i sub ${sel === 'Unknown' ? 'sel' : ''}">${sg('unknown')}Unknown<span class="n">63</span></div>
    <div class="ws-i ${sel === 'Recordings' ? 'sel' : ''}">${ic('wave')}Recordings</div>
    <div class="ws-h">Lists${ic('plus')}</div>
    <div class="ws-i ${sel === 'Jalopy' ? 'sel' : ''}">Saturday at the Jalopy<span class="n">8</span></div>
    <div class="ws-i">Clifftop 2026<span class="n">34</span></div>
    <div class="ws-i">October practice<span class="n">6</span></div>
    <div class="ws-foot"><div class="ws-i">${ic('gear')}Settings</div><div class="ws-rec"><span class="rec-dot"></span>Record</div></div>
  </aside>`

/** A web recording row. */
export const wRec = ([kind, title, sub]: Rec) =>
  `<div class="wrec"><span class="pl">${ic('play')}</span><span><b>${title}</b><small class="${kind === 'mine' ? '' : 'lk'}">${sub}${kind === 'mine' ? '' : ' ' + ic('ne')}</small></span></div>`

/** A phone recording row. */
export const pRec = ([kind, title, sub]: Rec) =>
  `<div class="prec"><span class="pl">${ic('play')}</span><span><b>${title}</b><small class="${kind === 'mine' ? '' : 'lk'}">${sub}</small></span></div>`

/** A browser window at native size around the web app. */
export const browser = (w: number, h: number, body: string, path = '') =>
  `<div class="bw" style="width:${w}px;height:${h}px">${chrome(path)}${body}</div>`

// Scans drawn as small pages: a staff, a handwritten note, and a chord chart.
export const scanSheet = `<div class="scan-sheet">${Array.from(
  { length: 6 },
  (_, i) =>
    `<div class="staff">${Array.from(
      { length: 6 },
      (_, j) => `<i style="left:${8 + j * 17}px;top:${[3, 9, 6, 13, 1, 8][(i + j) % 6]}px"></i>`,
    ).join('')}</div>`,
).join('')}</div>`
export const scanNote = `<div class="scan-note">B part:<br>hold the high A<br>long bow on<br>the turn</div>`
export const scanChord = `<div class="scan-chord"><div class="cap">Chords</div>A | A | D | A<br>A | A | E | A<br><span class="cap">B part</span><br>A | D | A | E</div>`

// One scale per composition. Devices are built at native size (a browser about 1280 wide, an
// iPhone 390 by 844) and every device in a panel shares one scale, so their text stays true to
// each other. CSS sizes the camera's height from the same formulas (demos.css), so the page lays
// out before this script runs and never shifts when it does.

export type CamKind = 'hero' | 'feat' | 'zoom' | 'tall' | 'plat'

/** Below this camera width a composition uses its mobile placement and height. */
export const MOBILE_BELOW = 640

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** The scale for a camera `inner` pixels wide. Mirrors the `--s` rules in demos.css. */
export function scaleFor(kind: CamKind, inner: number, mobile: boolean): number {
  const base = mobile ? clamp(inner / 540, 0.6, 0.74) : clamp(inner / 1040, 0.6, 0.74)
  switch (kind) {
    case 'zoom':
      return base * (mobile ? 1.24 : 1.3)
    case 'tall':
      return clamp(inner / (mobile ? 470 : 650), 0.6, 0.86)
    case 'hero':
      return mobile ? clamp(inner / 560, 0.55, 0.74) : clamp(inner / 1520, 0.5, 0.8)
    case 'plat':
      return inner / (mobile ? 900 : 2380)
    default:
      return base
  }
}

const num = (v: string | undefined) => (v === undefined || v === '' ? null : Number(v))

/**
 * Places each device on the stage from its `data-*` edges: `l` or `r` from the left or right
 * edge, `c` to center, `y` from the top, each with an `m` variant for mobile, and `hidem` to
 * drop it on mobile. A camera's `data-cw` centers a composition of that width on desktop.
 */
export function place(cam: HTMLElement): void {
  const stage = cam.firstElementChild as HTMLElement
  const mobile = cam.classList.contains('m')
  const width = stage.offsetWidth
  const cw = num(cam.dataset.cw)
  const off = cw && !mobile ? (width - cw) / 2 : 0
  for (const d of stage.querySelectorAll<HTMLElement>(':scope > [data-y]')) {
    const pick = (k: string) =>
      num(mobile && d.dataset[k + 'm'] !== undefined ? d.dataset[k + 'm'] : d.dataset[k])
    const hide = mobile && d.dataset.hidem !== undefined
    d.style.display = hide ? 'none' : ''
    if (hide) continue
    const l = pick('l')
    const r = pick('r')
    const centered = d.dataset.c !== undefined || (mobile && d.dataset.cm !== undefined)
    const w = d.offsetWidth
    const x = centered ? (width - w) / 2 : l !== null ? l + off : width - (r ?? 0) - w
    d.style.left = `${x}px`
    d.style.top = `${pick('y')}px`
  }
}

/** Sizes the stage to the camera and places its devices. Returns the scale. */
export function fit(cam: HTMLElement): number {
  const stage = cam.firstElementChild as HTMLElement
  const inner = cam.clientWidth
  const mobile = inner < MOBILE_BELOW
  cam.classList.toggle('m', mobile)
  const s = scaleFor(cam.dataset.kind as CamKind, inner, mobile)
  const h = Number(mobile ? cam.dataset.hm : cam.dataset.h)
  stage.style.width = `${inner / s}px`
  stage.style.height = `${h}px`
  stage.style.transform = `scale(${s})`
  stage.style.setProperty('--vw', `${inner / s}px`)
  place(cam)
  return s
}

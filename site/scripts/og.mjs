// Captures the built home page's hero as the 1200x630 link-preview image in public/og.png.
// Run through `just og`, which serves dist on the port this reads.
import { chromium } from 'playwright'

// The page's hero is taller than a preview, so the preview drops the lede and form, sets the
// headline on one line, and lets the demo panel fill the rest of the frame. Reduced motion holds
// the hero demo on its rest frame.
const LAYOUT = `
  .nav .nav-actions, .nav nav { display: none !important; }
  .nav { position: absolute !important; top: 0; left: 0; right: 0; background: none !important; }
  .nav .wrap { height: 92px !important; padding-inline: 64px !important; max-width: none !important; }
  .hero { max-width: none !important; padding: 104px 64px 0 !important; height: 630px; overflow: hidden; }
  .hero .top { display: block !important; }
  .hero-panel { margin-top: 28px !important; }
  .hero h1 { max-width: none !important; font-size: 56px !important; }
  .hero .side { display: none !important; }
`

const port = process.argv[2] ?? '4398'
const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  reducedMotion: 'reduce',
})
await page.goto(`http://localhost:${port}/`)
// The layout keys off the hero's class names, so a renamed one would leave a broken preview.
const SELECTORS = [
  '.nav',
  '.nav .wrap',
  '.nav nav',
  '.nav .nav-actions',
  '.hero',
  '.hero .top',
  '.hero h1',
  '.hero .side',
  '.hero-panel',
]
const missing = await page.evaluate(
  (selectors) => selectors.filter((selector) => !document.querySelector(selector)),
  SELECTORS,
)
if (missing.length > 0) {
  await browser.close()
  throw new Error(`the home page has no ${missing.join(', ')}; update the layout in og.mjs`)
}
await page.addStyleTag({ content: LAYOUT })
// The demo's camera scales on resize, so it refits to the preview's panel width.
await page.evaluate(async () => {
  await document.fonts.ready
  window.dispatchEvent(new Event('resize'))
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
})
await page.screenshot({ path: 'public/og.png' })
await browser.close()

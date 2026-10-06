// Captures the built home page's hero as the 1200x630 link-preview image in public/og.png.
// Run through `just og`, which serves dist on the port this reads.
import { chromium } from 'playwright'

// The page stacks the pinned phone under the headline, below a 630px frame, so the preview
// sets the headline beside the phone instead, without the lede, which a preview has no room for.
// Reduced motion keeps the first poster up.
const LAYOUT = `
  .nav { position: absolute !important; top: 56px; left: 72px; padding: 0 !important; }
  .nav .sections, .nav .nav-actions, .hero .lede, .hero .actions, .hero .micro, .hero .controls {
    display: none !important;
  }
  .hero {
    display: block !important;
    justify-items: start !important;
    position: relative;
    max-width: none !important;
    height: 630px;
    margin: 0 !important;
    padding: 150px 0 0 72px !important;
    overflow: hidden;
    text-align: left !important;
  }
  .hero .intro { margin: 0 !important; max-width: none !important; justify-items: start !important; text-align: left !important; }
  .hero h1 { max-width: 11ch !important; }
  .hero .runway { position: static !important; height: 0 !important; margin: 0 !important; padding: 0 !important; }
  .hero .snap { display: none !important; }
  .hero .stage {
    position: absolute !important;
    top: 40px !important;
    right: 120px;
    width: 260px !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  .hero .stack { width: 260px !important; }
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
  '.nav .sections',
  '.nav .nav-actions',
  '.hero',
  '.hero h1',
  '.hero .lede',
  '.hero .actions',
  '.hero .micro',
  '.hero .controls',
  '.hero .runway',
  '.hero .snap',
  '.hero .stage',
  '.hero .stack',
  '.hero img',
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
await page.evaluate(async () => {
  await document.fonts.ready
  await Promise.all([...document.querySelectorAll('.hero img')].map((img) => img.decode()))
})
await page.screenshot({ path: 'public/og.png' })
await browser.close()

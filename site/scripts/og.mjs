// Captures the built home page's hero as the 1200x630 link-preview image in public/og.png.
// Run through `just og`, which serves dist on the port this reads.
import { chromium } from 'playwright'

const port = process.argv[2] ?? '4398'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.goto(`http://localhost:${port}/`)
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: 'public/og.png' })
await browser.close()

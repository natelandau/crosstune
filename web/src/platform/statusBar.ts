/**
 * Keeps the browser and home-screen status bar the same color as the page. Ionic sets the page
 * background per mode and palette, so the value is read back rather than repeated here.
 */
export function syncStatusBar(): void {
  const color =
    getComputedStyle(document.documentElement).getPropertyValue('--ion-background-color').trim() ||
    // Ionic leaves the light page color implicit.
    '#ffffff'
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.remove())
  const meta = document.createElement('meta')
  meta.name = 'theme-color'
  meta.content = color
  document.head.append(meta)
}

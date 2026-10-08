/** The navigator fields the check reads, so a test can pass its own. */
export interface NavigatorLike {
  userAgent: string
  platform: string
  maxTouchPoints: number
}

/**
 * Whether this is an iPhone or iPad browser. iPadOS reports itself as a Mac, so a Mac with a
 * touch screen counts too, since no Mac has one.
 */
export function isAppleTouch(nav: NavigatorLike = navigator): boolean {
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return true
  return nav.platform === 'MacIntel' && nav.maxTouchPoints > 1
}

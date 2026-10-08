/** Which modifier the platform's shortcuts use: Cmd on Apple platforms, Ctrl elsewhere. */
export type KeyPlatform = 'mac' | 'other'

export const keyPlatform = (nav: Pick<Navigator, 'platform'> = navigator): KeyPlatform =>
  /Mac|iPhone|iPad|iPod/.test(nav.platform) ? 'mac' : 'other'

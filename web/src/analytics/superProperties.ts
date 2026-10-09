import { APP_VERSION } from '../version'

export const FORM_FACTORS = ['phone', 'tablet', 'desktop'] as const
export const DISPLAY_MODES = ['browser', 'standalone'] as const

export type FormFactor = (typeof FORM_FACTORS)[number]
export type DisplayMode = (typeof DISPLAY_MODES)[number]

export interface SuperPropertyEnv {
  coarsePointer: boolean
  shortSide: number
  standalone: boolean
}

const PHONE_SHORT_SIDE = 600

export function formFactor(env: { coarsePointer: boolean; shortSide: number }): FormFactor {
  if (!env.coarsePointer) return 'desktop'
  return env.shortSide < PHONE_SHORT_SIDE ? 'phone' : 'tablet'
}

export function displayMode(standalone: boolean): DisplayMode {
  return standalone ? 'standalone' : 'browser'
}

export function webSuperProperties(env: SuperPropertyEnv) {
  return {
    product: 'app',
    platform: 'web',
    app_version: APP_VERSION,
    form_factor: formFactor(env),
    display_mode: displayMode(env.standalone),
  } as const
}

export function readSuperPropertyEnv(): SuperPropertyEnv {
  return {
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    shortSide: Math.min(screen.width, screen.height),
    standalone: window.matchMedia('(display-mode: standalone)').matches,
  }
}

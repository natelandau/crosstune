import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where the web captures write their images; the Mac still comes from the Apple build folder. */
export const STILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '.out')

/** Captures made from a host app's window, not from a simulator test, so they carry no timeline. */
export const HOST_STILLS = ['family-mac', 'family-web', 'family-android']

/** The recipe that writes each host still. */
export const HOST_RECIPE: Record<string, string> = {
  'family-mac': 'just apple::capture-mac',
  'family-web': 'just site::capture-web',
  'family-android': 'just site::capture-web',
}

/** Splits requested names into host stills and simulator captures, keeping each group's order. */
export function splitNames(names: string[]): { hosts: string[]; simulator: string[] } {
  return {
    hosts: names.filter((name) => HOST_STILLS.includes(name)),
    simulator: names.filter((name) => !HOST_STILLS.includes(name)),
  }
}

/** Where a host still's PNG sits, given the Apple export folder the simulator captures use. */
export function hostStillPath(name: string, appleExport: string): string {
  return name === 'family-mac'
    ? join(resolve(appleExport, '..'), `${name}.png`)
    : join(STILL_DIR, `${name}.png`)
}

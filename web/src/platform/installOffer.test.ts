import { expect, it } from 'vitest'
import { pickInstallOffer } from './installOffer'

const NONE = { appStore: 'none', webInstall: false }

it.each([
  ['a Mac', true, false, false, false, { appStore: 'apple', webInstall: false }],
  [
    'an iPhone or iPad that can install',
    true,
    true,
    false,
    true,
    { appStore: 'badge', webInstall: false },
  ],
  ['an installed app on an Apple device', true, true, true, false, NONE],
  ['a phone that can install', false, true, false, true, { appStore: 'row', webInstall: true }],
  [
    'a phone that cannot install',
    false,
    true,
    false,
    false,
    { appStore: 'row', webInstall: false },
  ],
  ['an installed app on a phone', false, true, true, true, { appStore: 'row', webInstall: false }],
  ['a computer that can install', false, false, false, true, { appStore: 'qr', webInstall: false }],
  [
    'a computer that cannot install',
    false,
    false,
    false,
    false,
    { appStore: 'qr', webInstall: false },
  ],
] as const)('offers %s: %o', (_, apple, touch, installed, canPrompt, expected) => {
  expect(pickInstallOffer({ apple, touch, installed, canPrompt })).toEqual(expected)
})

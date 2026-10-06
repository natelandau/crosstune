// The pricing section: plan prices and bullets, and what happens to an account that stops paying.
export const PRICING_TITLE = 'Free for every tune you play. Premium when you want more.'
export const PRICING_LEDE =
  "Every new account gets 30 days of every Premium feature, with room for about 70 recordings. You don't need a card."

export const PRICES = { monthly: '$4.99', yearly: '$49.99', yearlySaving: '17%' }
export const PRICE_LINE = `${PRICES.yearly} a year (save ${PRICES.yearlySaving}), or ${PRICES.monthly} a month.`

export const PLAN_FREE = {
  name: 'Free',
  tagline: 'Everything you need at the jam.',
  bullets: [
    'Unlimited tunes, with lyrics, tunings, and filters',
    'Links to every music service, playing inside the app',
    'Offline use, sync to all your devices, and export',
    '5 recordings, notation scans on one tune, and one list',
    '50 MB of storage, enough for your 5 recordings at any quality',
  ],
}

export const PLAN_PREMIUM = {
  name: 'Crosstune Premium',
  tagline: 'Everything you need to learn tunes at home.',
  bullets: [
    'Unlimited recordings',
    'Upload audio files and save Slippery-Hill tunes',
    'Slow down, shift pitch, and loop',
    'Trim recordings',
    'Notation scans on every tune',
    'Unlimited lists',
    '5 GB of storage, about 3,500 three-minute tunes',
  ],
}

/** The promise in bold, then what it means. */
export const KEEP_PROMISE = 'If you stop paying, you keep what you made.'
export const KEEP_DETAIL =
  "Every recording still plays, every scan still opens, and every list still plays. You just can't add more than the free limits allow. Your speed, pitch, and loop settings come back if you subscribe again."
export const INACTIVE_RULE =
  "Your recordings and scans stay for as long as you use Crosstune. If none of your devices syncs for a year, we'll email you twice with a link to download everything before we remove them. Your tunes and lists stay either way."

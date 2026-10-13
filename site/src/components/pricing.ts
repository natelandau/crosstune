// The pricing section: plan prices and bullets.
export const PRICING_TITLE = 'Free for every tune you play. Premium when you want more'
export const PRICING_LEDE =
  "Every new account gets 30 days of every Premium feature, with room for about 70 recordings. You don't need a card."

export const PRICES = { monthly: '$4.99', yearly: '$49.99', yearlySaving: '17%' }

/** The billing periods the plan card switches between, yearly first. */
export const BILLING = {
  yearly: {
    label: 'Yearly',
    price: PRICES.yearly,
    per: 'a year',
    saving: `Save ${PRICES.yearlySaving}`,
  },
  monthly: { label: 'Monthly', price: PRICES.monthly, per: 'a month', saving: '' },
} as const

export const PLAN_FREE = {
  name: 'Free',
  tagline: 'Manage your tune lists.',
  price: '$0',
  per: 'forever',
  bullets: [
    'Unlimited tunes and lists, with lyrics, tunings, and filters',
    'Links to every music service, playing inside the app',
    'Offline use, sync to all your devices, and export',
    'Scans on one tune, with 50 MB of storage',
  ],
}

export const PLAN_PREMIUM = {
  name: 'Crosstune Premium',
  tagline: 'Everything you need to learn tunes at home.',
  bullets: [
    'Unlimited recordings',
    'Slow down, shift pitch, and loop',
    'Trim recordings',
    'Scans on every tune',
    '5 GB of storage, about 3,500 three-minute tunes',
  ],
}

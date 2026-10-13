import type { Store } from '../billing/store'

export function fakeStore(overrides: Partial<Store> = {}): Store {
  return {
    offers: async () => [
      { period: 'annual', price: '$49.99', amountMicros: 49_990_000 },
      { period: 'monthly', price: '$4.99', amountMicros: 4_990_000 },
    ],
    purchase: async () => 'completed',
    ...overrides,
  }
}

import type { Store } from '../billing/store'

export function fakeStore(overrides: Partial<Store> = {}): Store {
  return {
    offers: async () => [
      { period: 'annual', price: '$49.99' },
      { period: 'monthly', price: '$4.99' },
    ],
    purchase: async () => 'completed',
    ...overrides,
  }
}

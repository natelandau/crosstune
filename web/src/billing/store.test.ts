import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => {
  class PurchasesError extends Error {
    constructor(readonly errorCode: number) {
      super('purchases error')
    }
  }
  const instance = {
    user: '',
    getAppUserId: vi.fn(() => instance.user),
    changeUser: vi.fn(async (id: string) => {
      instance.user = id
    }),
    getOfferings: vi.fn(),
    purchase: vi.fn(),
  }
  const state = { configured: false }
  return {
    PurchasesError,
    instance,
    state,
    configure: vi.fn(({ appUserId }: { appUserId: string }) => {
      state.configured = true
      instance.user = appUserId
      return instance
    }),
  }
})

vi.mock('@revenuecat/purchases-js', () => ({
  ErrorCode: { UserCancelledError: 1, NetworkError: 10 },
  PurchasesError: sdk.PurchasesError,
  Purchases: {
    isConfigured: () => sdk.state.configured,
    configure: sdk.configure,
    getSharedInstance: () => sdk.instance,
  },
}))

import { revenueCatStore } from './revenueCatStore'

function pack(identifier: string, formattedPrice: string) {
  return { identifier, webBillingProduct: { price: { formattedPrice } } }
}

beforeEach(() => {
  sdk.state.configured = false
  sdk.instance.user = ''
  vi.clearAllMocks()
  sdk.instance.getOfferings.mockResolvedValue({
    current: {
      availablePackages: [pack('$rc_monthly', '$4.99'), pack('$rc_annual', '$49.99')],
    },
  })
  sdk.instance.purchase.mockResolvedValue({})
})

describe('revenueCatStore', () => {
  it('offers maps annual then monthly with their formatted prices', async () => {
    const store = revenueCatStore('rcb_key', 'user_1')
    expect(await store.offers()).toEqual([
      { period: 'annual', price: '$49.99' },
      { period: 'monthly', price: '$4.99' },
    ])
    expect(sdk.configure).toHaveBeenCalledWith({ apiKey: 'rcb_key', appUserId: 'user_1' })
  })

  it('purchase maps a user cancel to cancelled', async () => {
    sdk.instance.purchase.mockRejectedValue(new sdk.PurchasesError(1))
    expect(await revenueCatStore('rcb_key', 'user_1').purchase('annual')).toBe('cancelled')
  })

  it('purchase completes with the chosen package', async () => {
    const outcome = await revenueCatStore('rcb_key', 'user_1').purchase('monthly')
    expect(outcome).toBe('completed')
    expect(sdk.instance.purchase).toHaveBeenCalledWith({
      rcPackage: expect.objectContaining({ identifier: '$rc_monthly' }),
    })
  })

  it('purchase rethrows any other error', async () => {
    const failure = new sdk.PurchasesError(10)
    sdk.instance.purchase.mockRejectedValue(failure)
    await expect(revenueCatStore('rcb_key', 'user_1').purchase('annual')).rejects.toBe(failure)
  })

  it('a second user changes the RevenueCat user instead of configuring again', async () => {
    await revenueCatStore('rcb_key', 'user_1').offers()
    await revenueCatStore('rcb_key', 'user_2').offers()
    expect(sdk.configure).toHaveBeenCalledTimes(1)
    expect(sdk.instance.changeUser).toHaveBeenCalledWith('user_2')
  })

  it('a failed SDK open is retried on the next call', async () => {
    sdk.configure.mockImplementationOnce(() => {
      throw new Error('blocked')
    })
    const store = revenueCatStore('rcb_key', 'user_1')
    await expect(store.offers()).rejects.toThrow('blocked')

    expect(await store.offers()).toHaveLength(2)
    expect(sdk.configure).toHaveBeenCalledTimes(2)
  })

  it('purchase switches the shared SDK back to its own user first', async () => {
    const first = revenueCatStore('rcb_key', 'user_1')
    await first.offers()
    await revenueCatStore('rcb_key', 'user_2').offers()
    let buyer = ''
    sdk.instance.purchase.mockImplementation(async () => {
      buyer = sdk.instance.user
    })

    await first.purchase('annual')

    expect(buyer).toBe('user_1')
  })

  it('offers throws when RevenueCat is unreachable', async () => {
    sdk.instance.getOfferings.mockRejectedValue(new Error('offline'))
    await expect(revenueCatStore('rcb_key', 'user_1').offers()).rejects.toThrow('offline')
  })
})

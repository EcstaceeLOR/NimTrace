import { describe, expect, it, vi } from 'vitest'
import { getPublicCheckoutProgress } from './checkout-progress'

const BUYER = 'NQ22 TEST BUYER ADDRESS 0000000000000000000'
const SELLER = 'NQ11 TEST ISSUER ADDRESS 000000000000000000'
const TAG = 'NTP1:public-progress-test'
const HASH = 'a'.repeat(64)

function dbWithActiveIntent() {
  const first = vi.fn().mockResolvedValue({
    amount_luna: 100000,
    buyer_address: BUYER,
    confirmed_at: null,
    confirmed_block_height: null,
    created_at: '2026-09-24T00:00:00.000Z',
    expires_at: '2026-09-24T00:10:00.000Z',
    failure_code: null,
    id: 'abcdefghijklmnopqrstuvwx',
    network: 'main-albatross',
    product_id: 'product-checkout-progress-01',
    product_version: 1,
    seller_address: SELLER,
    status: 'submitted',
    transaction_data: TAG,
    transaction_hash: HASH,
  })
  const bind = vi.fn(() => ({ first }))
  const prepare = vi.fn(() => ({ bind }))
  return { db: { prepare } as unknown as D1Database, first }
}

function hex(value: string) {
  return Array.from(new TextEncoder().encode(value))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

describe('public checkout progress', () => {
  it('projects live inclusion/finality without exposing buyer or transaction identifiers', async () => {
    const { db } = dbWithActiveIntent()
    const rpc = {
      getTransaction: vi.fn().mockResolvedValue({
        status: 'found' as const,
        transaction: {
          blockNumber: 12345,
          confirmations: 24,
          executionResult: true,
          hash: HASH,
          networkId: 24,
          recipientData: hex(TAG),
          relatedAddresses: [BUYER],
          timestamp: Date.parse('2026-09-24T00:01:00.000Z') / 1000,
          to: SELLER,
          value: 100000,
        },
      }),
    }

    const progress = await getPublicCheckoutProgress(
      db,
      'product-checkout-progress-01',
      'main-albatross',
      rpc,
      new Date('2026-09-24T00:02:00.000Z'),
    )

    expect(progress).toMatchObject({
      blockHeight: 12345,
      confirmations: 24,
      finalityConfirmations: 60,
      finalityReached: false,
      included: true,
      transactionDetected: true,
    })
    expect(progress).not.toHaveProperty('buyerAddress')
    expect(progress).not.toHaveProperty('transactionHash')
    expect(progress).not.toHaveProperty('transactionData')
  })
})

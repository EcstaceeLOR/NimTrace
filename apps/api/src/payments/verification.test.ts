import type { PurchaseIntentResponse } from '@nimtrace/contracts'
import { describe, expect, it, vi } from 'vitest'
import basicFixture from './fixtures/testnet-basic-transaction.json'
import htlcFixture from './fixtures/testnet-htlc-payout.json'
import type { StoredPaymentIntent } from './repository'
import { NimiqRpcClient, RPC_ATTEMPTS_PER_PROVIDER } from './rpc'
import {
  FINALITY_CONFIRMATIONS,
  buyerRelationshipResult,
  verifyStoredPaymentIntent,
} from './verification'

function storedIntent(
  transaction: Record<string, unknown>,
  overrides: Partial<PurchaseIntentResponse> = {},
): StoredPaymentIntent {
  const timestamp = transaction.timestamp as number
  return {
    confirmedAt: null,
    confirmedBlockHeight: null,
    failureCode: null,
    intent: {
      amountLuna: transaction.value as number,
      buyerAddress: transaction.from as string,
      createdAt: new Date(timestamp - 60_000).toISOString(),
      expiresAt: new Date(timestamp + 9 * 60_000).toISOString(),
      id: 'fixtureIntentId000000001',
      network: 'test-albatross',
      productId: 'fixtureProductId0000000001',
      productVersion: 1,
      sellerAddress: transaction.to as string,
      status: 'submitted',
      transactionData: 'p:f76f4f2394d942a89e2fd579:1',
      ...overrides,
    },
    transactionHash: transaction.hash as string,
  }
}

function found(transaction: Record<string, unknown>) {
  return { getTransaction: async () => ({ status: 'found' as const, transaction }) }
}

describe('independent Nimiq transaction verification', () => {
  it('verifies every stored value against a real TestAlbatross transaction fixture', async () => {
    const transaction = basicFixture.transaction as Record<string, unknown>
    const result = await verifyStoredPaymentIntent(storedIntent(transaction), found(transaction))

    expect(result).toMatchObject({
      blockHeight: transaction.blockNumber,
      confirmations: transaction.confirmations,
      reason: 'verified_final',
      state: 'verified',
      transactionHash: transaction.hash,
    })
    expect(basicFixture.source).toMatchObject({
      method: 'getTransactionByHash',
      network: 'TestAlbatross',
    })
  })

  it('validates buyer context on a real HTLC payout without treating its contract sender as the wallet', async () => {
    const transaction = htlcFixture.transaction as Record<string, unknown>
    const buyerAddress = (transaction.relatedAddresses as string[])[1]!
    expect(transaction.fromType).toBe(2)
    expect(transaction.from).not.toBe(buyerAddress)
    expect(buyerRelationshipResult(transaction, buyerAddress)).toBe('matches')

    const result = await verifyStoredPaymentIntent(storedIntent(transaction, {
      buyerAddress,
    }), found(transaction))
    // This real swap payout has no NimTrace tag, so relationship evidence alone
    // is deliberately insufficient to settle a purchase intent.
    expect(result).toMatchObject({ reason: 'transaction_data_mismatch', state: 'rejected' })
  })

  it.each([
    ['transaction_hash_mismatch', { hash: 'f'.repeat(64) }],
    ['network_mismatch', { networkId: 24 }],
    ['execution_failed', { executionResult: false }],
    ['recipient_mismatch', { to: 'NQ00 WRONG RECIPIENT' }],
    ['amount_mismatch', { value: 999999 }],
    ['transaction_data_mismatch', { recipientData: '77726f6e67' }],
    ['buyer_unrelated', { relatedAddresses: ['NQ00 UNRELATED WALLET'] }],
  ])('rejects a confirmed transaction with %s', async (reason, mutation) => {
    const base = basicFixture.transaction as Record<string, unknown>
    const transaction = { ...base, ...mutation }
    const result = await verifyStoredPaymentIntent(storedIntent(base), found(transaction))
    expect(result).toMatchObject({ reason, state: 'rejected' })
  })

  it('returns pending until macro-block finality and does not turn provider failure into rejection', async () => {
    const transaction = basicFixture.transaction as Record<string, unknown>
    const awaitingFinality = await verifyStoredPaymentIntent(
      storedIntent(transaction),
      found({ ...transaction, confirmations: FINALITY_CONFIRMATIONS - 1 }),
    )
    expect(awaitingFinality).toMatchObject({ reason: 'awaiting_finality', state: 'pending' })

    const notFound = await verifyStoredPaymentIntent(storedIntent(transaction), {
      getTransaction: async () => ({ status: 'not_found' }),
    })
    expect(notFound).toMatchObject({ reason: 'transaction_not_found', state: 'pending' })

    const unavailable = await verifyStoredPaymentIntent(storedIntent(transaction), {
      getTransaction: async () => ({ status: 'unavailable' }),
    })
    expect(unavailable).toMatchObject({ reason: 'provider_unavailable', state: 'inconclusive' })
  })

  it('rejects chain evidence outside the intent window but keeps incomplete provider data inconclusive', async () => {
    const transaction = basicFixture.transaction as Record<string, unknown>
    const late = await verifyStoredPaymentIntent(
      storedIntent(transaction),
      found({ ...transaction, timestamp: (transaction.timestamp as number) + 12 * 60_000 }),
    )
    expect(late).toMatchObject({ reason: 'transaction_time_invalid', state: 'rejected' })

    const incomplete = { ...transaction }
    delete incomplete.hash
    const invalid = await verifyStoredPaymentIntent(storedIntent(transaction), found(incomplete))
    expect(invalid).toMatchObject({ reason: 'provider_response_invalid', state: 'inconclusive' })
  })
})

describe('bounded read-only RPC lookup', () => {
  it('retries the primary, then uses the fallback without exposing mutation methods', async () => {
    const transaction = basicFixture.transaction as Record<string, unknown>
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('primary offline'))
      .mockRejectedValueOnce(new Error('primary still offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { data: transaction } }), { status: 200 }))
    const client = new NimiqRpcClient({
      fallbackUrl: 'https://fallback.example/rpc',
      fetcher,
      primaryUrl: 'https://primary.example/rpc',
      timeoutMs: 20,
    })

    await expect(client.getTransaction(transaction.hash as string)).resolves.toEqual({
      status: 'found',
      transaction,
    })
    expect(fetcher).toHaveBeenCalledTimes(RPC_ATTEMPTS_PER_PROVIDER + 1)
    for (const call of fetcher.mock.calls) {
      const request = JSON.parse(String(call[1]?.body)) as { method: string; params: string[] }
      expect(request).toEqual(expect.objectContaining({
        method: 'getTransactionByHash',
        params: [transaction.hash],
      }))
    }
  })

  it('caps unavailable providers at two attempts each', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))
    const client = new NimiqRpcClient({
      fallbackUrl: 'https://fallback.example/rpc',
      fetcher,
      primaryUrl: 'https://primary.example/rpc',
      timeoutMs: 10,
    })

    await expect(client.getTransaction('a'.repeat(64))).resolves.toEqual({ status: 'unavailable' })
    expect(fetcher).toHaveBeenCalledTimes(RPC_ATTEMPTS_PER_PROVIDER * 2)
  })
})

import type { WalletChallengeResponse } from '@nimtrace/contracts'
import { describe, expect, it, vi } from 'vitest'
import { authenticateWallet } from './auth'

const address = 'NQ12 TEST 0000 0000 0000 0000 0000 0000 0000'
const challenge: WalletChallengeResponse = {
  challengeId: 'challenge-id-with-enough-entropy',
  walletAddress: address,
  network: 'main-albatross',
  issuedAt: '2026-09-14T12:00:00.000Z',
  expiresAt: '2026-09-14T12:05:00.000Z',
  message: 'NimTrace wallet sign-in\n\nAuthorize this wallet to access NimTrace. '.repeat(2),
}

function wallet() {
  return {
    connect: vi.fn().mockResolvedValue({
      status: 'success',
      value: { address, accounts: [address] },
    }),
    sign: vi.fn().mockResolvedValue({
      status: 'success',
      value: { publicKey: 'a'.repeat(64), signature: 'b'.repeat(128) },
    }),
  }
}

describe('authenticateWallet', () => {
  it('signs the exact readable server challenge and returns an in-memory session', async () => {
    const adapter = wallet()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(challenge), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sessionToken: 's'.repeat(43),
        walletAddress: address,
        expiresAt: '2026-09-15T12:00:00.000Z',
      }), { status: 201 }))

    await expect(authenticateWallet({ fetcher, wallet: adapter })).resolves.toMatchObject({
      status: 'success',
      session: { walletAddress: address },
    })
    expect(adapter.sign).toHaveBeenCalledWith(challenge.message)
    expect(JSON.parse(fetcher.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      challengeId: challenge.challengeId,
      walletAddress: address,
    })
  })

  it('treats a rejected signature as cancellation without creating a session', async () => {
    const adapter = wallet()
    adapter.sign.mockResolvedValue({ status: 'cancelled', code: 'USER_CANCELLED' })
    const fetcher = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify(challenge), { status: 201 }),
    )

    await expect(authenticateWallet({ fetcher, wallet: adapter })).resolves.toEqual({
      status: 'cancelled',
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('surfaces an expired challenge as a recoverable retry', async () => {
    const adapter = wallet()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(challenge), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: 'challenge_expired',
        message: 'This sign-in request expired. Please try again.',
        recoverable: true,
      }), { status: 410 }))

    await expect(authenticateWallet({ fetcher, wallet: adapter })).resolves.toMatchObject({
      status: 'error',
      error: { code: 'challenge_expired', retryable: true },
    })
  })
})

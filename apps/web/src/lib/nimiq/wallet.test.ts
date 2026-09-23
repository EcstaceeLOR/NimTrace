import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNimiqPayDeepLink, NimiqPayWalletAdapter, normalizeWalletError } from './wallet'
import { createNimiqPayHttpsLink } from './deepLink'

const account = 'NQ12 TEST 0000 0000 0000 0000 0000 0000 0000'

function fakeProvider(overrides: Record<string, unknown> = {}) {
  return {
    listAccounts: vi.fn().mockResolvedValue([account]),
    sign: vi.fn().mockResolvedValue({ publicKey: 'public-key', signature: 'signature' }),
    isConsensusEstablished: vi.fn().mockResolvedValue(true),
    getBlockNumber: vi.fn().mockResolvedValue(42),
    sendBasicTransactionWithData: vi.fn().mockResolvedValue('transaction-hash'),
    ...overrides,
  }
}

function adapterFor(
  provider = fakeProvider(),
  options: { timeoutMs?: number; interactiveTimeoutMs?: number; hostAvailable?: boolean } = {},
) {
  const requestDeviceIdentifier = vi.fn().mockResolvedValue('a'.repeat(64))
  const init = vi.fn().mockResolvedValue(provider)
  const adapter = new NimiqPayWalletAdapter({
    timeoutMs: options.timeoutMs,
    interactiveTimeoutMs: options.interactiveTimeoutMs,
    hostAvailable: () => options.hostAvailable ?? true,
    currentUrl: () => 'https://nimtrace.example/products/demo?ref=qr',
    sdk: { init, requestDeviceIdentifier },
  })

  return { adapter, init, requestDeviceIdentifier }
}

describe('NimiqPayWalletAdapter', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('connects through the SDK and selects the first normalized account', async () => {
    const { adapter, init } = adapterFor()

    await expect(adapter.connect()).resolves.toEqual({
      status: 'success',
      value: { address: account, accounts: [account] },
    })
    expect(init).toHaveBeenCalledWith({ timeout: 15_000 })
  })

  it('treats provider rejection as a normal cancelled outcome', async () => {
    const provider = fakeProvider({
      listAccounts: vi.fn().mockResolvedValue({
        error: { type: 'PERMISSION_DENIED', message: 'User rejected account access' },
      }),
    })

    await expect(adapterFor(provider).adapter.connect()).resolves.toEqual({
      status: 'cancelled',
      code: 'USER_CANCELLED',
    })
  })

  it('does not initialize the provider outside Nimiq Pay', async () => {
    const { adapter, init } = adapterFor(fakeProvider(), { hostAvailable: false })

    const outcome = await adapter.connect()

    expect(outcome).toMatchObject({ status: 'error', error: { code: 'PROVIDER_MISSING' } })
    expect(init).not.toHaveBeenCalled()
  })

  it('rejects malformed account responses with a stable code', async () => {
    const provider = fakeProvider({ listAccounts: vi.fn().mockResolvedValue({ accounts: [account] }) })

    await expect(adapterFor(provider).adapter.connect()).resolves.toMatchObject({
      status: 'error',
      error: { code: 'INVALID_PROVIDER_RESPONSE' },
    })
  })

  it('normalizes a provider request timeout', async () => {
    vi.useFakeTimers()
    const provider = fakeProvider({ listAccounts: vi.fn(() => new Promise(() => undefined)) })
    const pending = adapterFor(provider, { timeoutMs: 100 }).adapter.connect()

    await vi.advanceTimersByTimeAsync(101)

    await expect(pending).resolves.toMatchObject({ status: 'error', error: { code: 'REQUEST_TIMEOUT' } })
  })

  it('allows interactive payment approval to outlive the short provider timeout', async () => {
    vi.useFakeTimers()
    const provider = fakeProvider({
      sendBasicTransactionWithData: vi.fn(() => new Promise<string>((resolve) => {
        setTimeout(() => resolve('transaction-hash'), 150)
      })),
    })
    const { adapter } = adapterFor(provider, { timeoutMs: 100, interactiveTimeoutMs: 300 })
    const pending = adapter.pay({ recipient: account, valueLuna: 100_000, data: 'nt:purchase:abc123' })

    await vi.advanceTimersByTimeAsync(151)

    await expect(pending).resolves.toEqual({ status: 'success', value: { transactionHash: 'transaction-hash' } })
  })

  it('normalizes signatures and rejects malformed provider results', async () => {
    const successful = adapterFor().adapter
    await expect(successful.sign('Sign in to NimTrace')).resolves.toEqual({
      status: 'success',
      value: { publicKey: 'public-key', signature: 'signature' },
    })

    const malformed = adapterFor(fakeProvider({
      sign: vi.fn().mockResolvedValue({ publicKey: '', signature: '' }),
    })).adapter
    await expect(malformed.sign('Sign in')).resolves.toMatchObject({
      status: 'error',
      error: { code: 'INVALID_PROVIDER_RESPONSE' },
    })
  })

  it('sends exact server-provided tagged payment values', async () => {
    const provider = fakeProvider()
    const { adapter } = adapterFor(provider)

    await expect(adapter.pay({
      recipient: account,
      valueLuna: 100_000,
      data: 'nt:purchase:abc123',
      feeLuna: 138,
      validityStartHeight: 42,
    })).resolves.toEqual({ status: 'success', value: { transactionHash: 'transaction-hash' } })
    expect(provider.sendBasicTransactionWithData).toHaveBeenCalledWith({
      recipient: account,
      value: 100_000,
      data: 'nt:purchase:abc123',
      fee: 138,
      validityStartHeight: 42,
    })
  })

  it('blocks unsafe Luna values before invoking Nimiq Pay', async () => {
    const provider = fakeProvider()
    const { adapter } = adapterFor(provider)

    await expect(adapter.pay({ recipient: account, valueLuna: 1.5, data: 'tag' })).resolves.toMatchObject({
      status: 'error',
      error: { code: 'INVALID_REQUEST' },
    })
    expect(provider.sendBasicTransactionWithData).not.toHaveBeenCalled()
  })

  it('checks consensus and returns the current block height', async () => {
    const { adapter } = adapterFor()
    await expect(adapter.checkConsensus()).resolves.toEqual({
      status: 'success',
      value: { established: true, blockNumber: 42 },
    })

    const unavailable = adapterFor(fakeProvider({
      isConsensusEstablished: vi.fn().mockResolvedValue(false),
    })).adapter
    await expect(unavailable.checkConsensus()).resolves.toMatchObject({
      status: 'error',
      error: { code: 'CONSENSUS_UNAVAILABLE', retryable: true },
    })
  })

  it('requests a consented device identifier only inside the host', async () => {
    const inside = adapterFor()
    await expect(inside.adapter.deviceId('Prevent duplicate product claims')).resolves.toEqual({
      status: 'success',
      value: 'a'.repeat(64),
    })
    expect(inside.requestDeviceIdentifier).toHaveBeenCalledWith({ reason: 'Prevent duplicate product claims' })

    const outside = adapterFor(fakeProvider(), { hostAvailable: false })
    await expect(outside.adapter.deviceId('Prevent duplicate product claims')).resolves.toEqual({
      status: 'success',
      value: null,
    })
    expect(outside.requestDeviceIdentifier).not.toHaveBeenCalled()
  })

  it.each([
    [{ error: { type: 'INVALID_TRANSACTION', message: 'Bad recipient' } }, 'INVALID_TRANSACTION'],
    [new Error('Network connection failed'), 'NETWORK_FAILURE'],
    [{ code: 'CONFIRMATION_DELAYED' }, 'CONFIRMATION_DELAYED'],
  ])('normalizes %o to %s', (error, code) => {
    expect(normalizeWalletError(error)).toMatchObject({ status: 'error', error: { code } })
  })

  it('creates a path-preserving Nimiq Pay Mini App link', () => {
    const target = 'https://nimtrace.example/products/demo?ref=qr#passport'
    expect(createNimiqPayDeepLink(target)).toBe(
      `nimiqpay://miniapp?url=${encodeURIComponent(target)}`,
    )
  })

  it('creates the public HTTPS Nimiq Pay Mini App entry link', () => {
    expect(createNimiqPayHttpsLink('https://nimtrace.example/products/demo?ref=qr'))
      .toBe('https://nimpay.app/miniapps/open/nimtrace.example')
  })
})

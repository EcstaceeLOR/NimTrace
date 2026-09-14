import {
  init,
  requestDeviceIdentifier,
  type ErrorResponse,
  type NimiqProvider,
  type SignatureResult,
} from '@nimiq/mini-app-sdk'
import { createNimiqPayDeepLink } from './deepLink'
import {
  normalizeWalletError,
  successfulWalletOutcome,
  WalletAdapterError,
  type WalletOutcome,
} from './errors'

export interface WalletConnection {
  address: string
  accounts: string[]
}

export interface WalletSignature {
  publicKey: string
  signature: string
}

export interface WalletPayment {
  transactionHash: string
}

export interface WalletConsensus {
  established: true
  blockNumber: number
}

export interface TaggedPaymentInput {
  recipient: string
  valueLuna: number
  data: string
  feeLuna?: number
  validityStartHeight?: number
}

type ProviderPort = Pick<
  NimiqProvider,
  'listAccounts' | 'sign' | 'isConsensusEstablished' | 'getBlockNumber' | 'sendBasicTransactionWithData'
>

interface SdkPort {
  init(options?: { timeout?: number }): Promise<ProviderPort>
  requestDeviceIdentifier(options: { reason: string }): Promise<string>
}

export interface WalletAdapterOptions {
  timeoutMs?: number
  sdk?: SdkPort
  hostAvailable?: () => boolean
  currentUrl?: () => string
}

const browserSdk: SdkPort = { init, requestDeviceIdentifier }

function defaultHostAvailable() {
  return typeof window !== 'undefined' && Boolean(window.nimiqPay || window.nimiq)
}

function defaultCurrentUrl() {
  if (typeof window === 'undefined') throw new WalletAdapterError('INVALID_REQUEST')
  return window.location.href
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const error = (value as { error?: unknown }).error
  return typeof error === 'object' && error !== null && 'type' in error && 'message' in error
}

function validateInteger(value: number | undefined, field: string, minimum = 0) {
  if (value === undefined) return
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new WalletAdapterError('INVALID_REQUEST', `${field} must be a safe integer.`)
  }
}

export class NimiqPayWalletAdapter {
  readonly #timeoutMs: number
  readonly #sdk: SdkPort
  readonly #hostAvailable: () => boolean
  readonly #currentUrl: () => string
  #providerPromise?: Promise<ProviderPort>

  constructor(options: WalletAdapterOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? 15_000
    this.#sdk = options.sdk ?? browserSdk
    this.#hostAvailable = options.hostAvailable ?? defaultHostAvailable
    this.#currentUrl = options.currentUrl ?? defaultCurrentUrl
  }

  isAvailable(): boolean {
    return this.#hostAvailable()
  }

  deepLink(targetUrl = this.#currentUrl()): string {
    return createNimiqPayDeepLink(targetUrl)
  }

  async connect(): Promise<WalletOutcome<WalletConnection>> {
    return this.#run(async (provider) => {
      const response = await provider.listAccounts()
      if (isErrorResponse(response)) throw response
      if (!Array.isArray(response)) throw new WalletAdapterError('INVALID_PROVIDER_RESPONSE')

      const accounts = response.filter((address) => typeof address === 'string' && address.trim().length > 0)
      const address = accounts[0]
      if (!address) throw new WalletAdapterError('INVALID_PROVIDER_RESPONSE')

      return { address, accounts }
    })
  }

  async sign(payload: string): Promise<WalletOutcome<WalletSignature>> {
    if (!payload.trim()) return normalizeWalletError(new WalletAdapterError('INVALID_REQUEST'))

    return this.#run(async (provider) => {
      const response = await provider.sign(payload)
      if (isErrorResponse(response)) throw response
      this.#assertSignature(response)
      return response
    })
  }

  async pay(input: TaggedPaymentInput): Promise<WalletOutcome<WalletPayment>> {
    try {
      if (!input.recipient.trim() || !input.data.trim()) throw new WalletAdapterError('INVALID_REQUEST')
      validateInteger(input.valueLuna, 'valueLuna', 1)
      validateInteger(input.feeLuna, 'feeLuna')
      validateInteger(input.validityStartHeight, 'validityStartHeight')
    } catch (error) {
      return normalizeWalletError(error)
    }

    return this.#run(async (provider) => {
      const response = await provider.sendBasicTransactionWithData({
        recipient: input.recipient,
        value: input.valueLuna,
        data: input.data,
        ...(input.feeLuna === undefined ? {} : { fee: input.feeLuna }),
        ...(input.validityStartHeight === undefined ? {} : { validityStartHeight: input.validityStartHeight }),
      })
      if (isErrorResponse(response)) throw response
      if (typeof response !== 'string' || !response.trim()) {
        throw new WalletAdapterError('INVALID_PROVIDER_RESPONSE')
      }
      return { transactionHash: response }
    })
  }

  async checkConsensus(): Promise<WalletOutcome<WalletConsensus>> {
    return this.#run(async (provider) => {
      const established = await provider.isConsensusEstablished()
      if (!established) throw new WalletAdapterError('CONSENSUS_UNAVAILABLE')

      const blockNumber = await provider.getBlockNumber()
      if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) {
        throw new WalletAdapterError('INVALID_PROVIDER_RESPONSE')
      }

      return { established: true, blockNumber }
    })
  }

  async deviceId(reason: string): Promise<WalletOutcome<string | null>> {
    if (!reason.trim()) return normalizeWalletError(new WalletAdapterError('INVALID_REQUEST'))
    if (!this.isAvailable()) return successfulWalletOutcome(null)

    try {
      const identifier = await this.#withTimeout(this.#sdk.requestDeviceIdentifier({ reason }))
      if (!/^[a-f0-9]{64}$/i.test(identifier)) throw new WalletAdapterError('INVALID_PROVIDER_RESPONSE')
      return successfulWalletOutcome(identifier)
    } catch (error) {
      return normalizeWalletError(error)
    }
  }

  async #provider(): Promise<ProviderPort> {
    if (!this.isAvailable()) throw new WalletAdapterError('PROVIDER_MISSING')

    this.#providerPromise ??= this.#withTimeout(this.#sdk.init({ timeout: this.#timeoutMs }))
    try {
      return await this.#providerPromise
    } catch (error) {
      this.#providerPromise = undefined
      throw error
    }
  }

  async #run<T>(operation: (provider: ProviderPort) => Promise<T>): Promise<WalletOutcome<T>> {
    try {
      const provider = await this.#provider()
      return successfulWalletOutcome(await this.#withTimeout(operation(provider)))
    } catch (error) {
      return normalizeWalletError(error)
    }
  }

  async #withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new WalletAdapterError('REQUEST_TIMEOUT')), this.#timeoutMs)
    })

    try {
      return await Promise.race([operation, timeout])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  #assertSignature(value: SignatureResult): asserts value is WalletSignature {
    if (!value.publicKey?.trim() || !value.signature?.trim()) {
      throw new WalletAdapterError('INVALID_PROVIDER_RESPONSE')
    }
  }
}

export const nimiqPayWallet = new NimiqPayWalletAdapter()

export type { WalletError, WalletErrorCode, WalletOutcome } from './errors'
export { normalizeWalletError } from './errors'
export { createNimiqPayDeepLink } from './deepLink'

import type { NimiqNetwork } from '@nimtrace/contracts'

export const RPC_ATTEMPTS_PER_PROVIDER = 2
export const RPC_TIMEOUT_MS = 4_000

export type NimiqRpcTransaction = Record<string, unknown>

export type TransactionLookupResult =
  | { status: 'found'; transaction: NimiqRpcTransaction }
  | { status: 'not_found' }
  | { status: 'unavailable' }
  | { status: 'invalid' }

export type TransactionHistoryLookupResult =
  | { status: 'found'; transactions: NimiqRpcTransaction[] }
  | { status: 'unavailable' }
  | { status: 'invalid' }

interface RpcClientOptions {
  attemptsPerProvider?: number
  fallbackUrl?: string
  fetcher?: typeof fetch
  primaryUrl?: string
  timeoutMs?: number
}

interface JsonRpcEnvelope {
  error?: { code?: unknown; data?: unknown; message?: unknown }
  result?: unknown
}

function providerUrls(primaryUrl?: string, fallbackUrl?: string) {
  return [...new Set([primaryUrl, fallbackUrl]
    .map((url) => url?.trim())
    .filter((url): url is string => Boolean(url)))]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNotFound(error: JsonRpcEnvelope['error']) {
  const detail = `${String(error?.message ?? '')} ${String(error?.data ?? '')}`.toLowerCase()
  return detail.includes('not found') || detail.includes('unknown transaction')
}

function unwrapTransaction(envelope: JsonRpcEnvelope): NimiqRpcTransaction | null {
  if (!isObject(envelope.result)) return null
  const result = envelope.result
  if ('data' in result) return isObject(result.data) ? result.data : null
  return result
}

function unwrapTransactions(envelope: JsonRpcEnvelope): NimiqRpcTransaction[] | null {
  const result = envelope.result
  const transactions = Array.isArray(result)
    ? result
    : isObject(result) && 'data' in result
      ? result.data
      : null
  if (!Array.isArray(transactions) || !transactions.every(isObject)) return null
  return transactions
}

async function requestTransaction(
  fetcher: typeof fetch,
  url: string,
  hash: string,
  timeoutMs: number,
): Promise<{ kind: 'found'; transaction: NimiqRpcTransaction }
  | { kind: 'not_found' | 'retry' | 'invalid' }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(url, {
      body: JSON.stringify({
        id: `nimtrace-${hash.slice(0, 12)}`,
        jsonrpc: '2.0',
        method: 'getTransactionByHash',
        params: [hash],
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    })
    if (!response.ok) return { kind: 'retry' }

    let envelope: unknown
    try {
      envelope = await response.json()
    } catch {
      return { kind: 'invalid' }
    }
    if (!isObject(envelope)) return { kind: 'invalid' }
    const rpcEnvelope = envelope as JsonRpcEnvelope
    if (rpcEnvelope.error) {
      return { kind: isNotFound(rpcEnvelope.error) ? 'not_found' : 'retry' }
    }
    const transaction = unwrapTransaction(rpcEnvelope)
    return transaction ? { kind: 'found', transaction } : { kind: 'invalid' }
  } catch {
    return { kind: 'retry' }
  } finally {
    clearTimeout(timeout)
  }
}

async function requestTransactionsByAddress(
  fetcher: typeof fetch,
  url: string,
  address: string,
  limit: number,
  timeoutMs: number,
): Promise<{ kind: 'found'; transactions: NimiqRpcTransaction[] }
  | { kind: 'retry' | 'invalid' }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(url, {
      body: JSON.stringify({
        id: `nimtrace-address-${address.replace(/\s/g, '').slice(0, 12)}`,
        jsonrpc: '2.0',
        method: 'getTransactionsByAddress',
        params: [address, limit, null],
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    })
    if (!response.ok) return { kind: 'retry' }

    let envelope: unknown
    try {
      envelope = await response.json()
    } catch {
      return { kind: 'invalid' }
    }
    if (!isObject(envelope)) return { kind: 'invalid' }
    const rpcEnvelope = envelope as JsonRpcEnvelope
    if (rpcEnvelope.error) return { kind: 'retry' }
    const transactions = unwrapTransactions(rpcEnvelope)
    return transactions ? { kind: 'found', transactions } : { kind: 'invalid' }
  } catch {
    return { kind: 'retry' }
  } finally {
    clearTimeout(timeout)
  }
}

export class NimiqRpcClient {
  readonly #fetcher: typeof fetch
  readonly #attemptsPerProvider: number
  readonly #providers: string[]
  readonly #timeoutMs: number

  constructor(options: RpcClientOptions) {
    this.#attemptsPerProvider = Math.max(1, Math.trunc(options.attemptsPerProvider ?? RPC_ATTEMPTS_PER_PROVIDER))
    this.#fetcher = options.fetcher ?? fetch
    this.#providers = providerUrls(options.primaryUrl, options.fallbackUrl)
    this.#timeoutMs = options.timeoutMs ?? RPC_TIMEOUT_MS
  }

  async getTransaction(hash: string): Promise<TransactionLookupResult> {
    let sawInvalid = false
    let sawNotFound = false

    for (const provider of this.#providers) {
      for (let attempt = 0; attempt < this.#attemptsPerProvider; attempt += 1) {
        const result = await requestTransaction(this.#fetcher, provider, hash, this.#timeoutMs)
        if (result.kind === 'found') return { status: 'found', transaction: result.transaction }
        if (result.kind === 'not_found') {
          sawNotFound = true
          break
        }
        if (result.kind === 'invalid') {
          sawInvalid = true
          break
        }
      }
    }

    if (sawNotFound) return { status: 'not_found' }
    if (sawInvalid) return { status: 'invalid' }
    return { status: 'unavailable' }
  }

  async getTransactionsByAddress(address: string, limit = 100): Promise<TransactionHistoryLookupResult> {
    let sawInvalid = false
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500)

    for (const provider of this.#providers) {
      for (let attempt = 0; attempt < this.#attemptsPerProvider; attempt += 1) {
        const result = await requestTransactionsByAddress(
          this.#fetcher,
          provider,
          address,
          boundedLimit,
          this.#timeoutMs,
        )
        if (result.kind === 'found') return { status: 'found', transactions: result.transactions }
        if (result.kind === 'invalid') {
          sawInvalid = true
          break
        }
      }
    }

    return { status: sawInvalid ? 'invalid' : 'unavailable' }
  }
}

export function communityRpcUrl(network: NimiqNetwork) {
  return network === 'test-albatross'
    ? 'https://rpc.testnet.nimiqwatch.com/'
    : 'https://rpc.nimiqwatch.com/'
}

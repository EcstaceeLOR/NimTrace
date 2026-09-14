export const walletErrorCodes = [
  'USER_CANCELLED',
  'PROVIDER_MISSING',
  'REQUEST_TIMEOUT',
  'INVALID_TRANSACTION',
  'NETWORK_FAILURE',
  'CONSENSUS_UNAVAILABLE',
  'CONFIRMATION_DELAYED',
  'INVALID_PROVIDER_RESPONSE',
  'INVALID_REQUEST',
  'UNKNOWN',
] as const

export type WalletErrorCode = (typeof walletErrorCodes)[number]

export interface WalletError {
  code: Exclude<WalletErrorCode, 'USER_CANCELLED'>
  message: string
  retryable: boolean
}

export type WalletOutcome<T> =
  | { status: 'success'; value: T }
  | { status: 'cancelled'; code: 'USER_CANCELLED' }
  | { status: 'error'; error: WalletError }

const descriptions: Record<Exclude<WalletErrorCode, 'USER_CANCELLED'>, string> = {
  PROVIDER_MISSING: 'Open this action in Nimiq Pay to use your wallet.',
  REQUEST_TIMEOUT: 'Nimiq Pay did not respond in time. Please try again.',
  INVALID_TRANSACTION: 'Nimiq Pay rejected the transaction details as invalid.',
  NETWORK_FAILURE: 'The wallet network request failed. Check your connection and try again.',
  CONSENSUS_UNAVAILABLE: 'Nimiq Pay is still synchronizing with the network.',
  CONFIRMATION_DELAYED: 'The transaction was submitted, but confirmation is still pending.',
  INVALID_PROVIDER_RESPONSE: 'Nimiq Pay returned an unexpected response.',
  INVALID_REQUEST: 'The wallet request is invalid.',
  UNKNOWN: 'The wallet action could not be completed.',
}

const retryableCodes = new Set<WalletError['code']>([
  'REQUEST_TIMEOUT',
  'NETWORK_FAILURE',
  'CONSENSUS_UNAVAILABLE',
  'CONFIRMATION_DELAYED',
  'UNKNOWN',
])

export class WalletAdapterError extends Error {
  constructor(readonly code: WalletError['code'], message?: string) {
    super(message ?? descriptions[code])
    this.name = 'WalletAdapterError'
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function errorDetails(error: unknown) {
  const record = asRecord(error)
  const nested = asRecord(record?.error)
  const parts = [
    record?.code,
    record?.type,
    record?.name,
    record?.message,
    nested?.code,
    nested?.type,
    nested?.message,
  ].filter((value): value is string => typeof value === 'string')

  return parts.join(' ').toUpperCase()
}

function failure(code: WalletError['code']): WalletOutcome<never> {
  return {
    status: 'error',
    error: {
      code,
      message: descriptions[code],
      retryable: retryableCodes.has(code),
    },
  }
}

export function normalizeWalletError(error: unknown): WalletOutcome<never> {
  if (error instanceof WalletAdapterError) return failure(error.code)

  const details = errorDetails(error)

  if (/PERMISSION_DENIED|USER_REJECT|USER_DENIED|CANCELLED|CANCELED|REJECTED_BY_USER/.test(details)) {
    return { status: 'cancelled', code: 'USER_CANCELLED' }
  }
  if (/PROVIDER_MISSING|NOT_INJECTED|NOT INJECTED|NIMIQ PROVIDER.*UNAVAILABLE|RUNNING INSIDE.*NIMIQ/.test(details)) {
    return failure('PROVIDER_MISSING')
  }
  if (/INVALID_TRANSACTION|INVALID TRANSACTION/.test(details)) return failure('INVALID_TRANSACTION')
  if (/CONSENSUS_UNAVAILABLE|CONSENSUS.*NOT.*ESTABLISHED|CONSENSUS.*UNAVAILABLE/.test(details)) {
    return failure('CONSENSUS_UNAVAILABLE')
  }
  if (/CONFIRMATION_DELAYED|DELAYED_CONFIRMATION|TRANSACTION_PENDING|CONFIRMATION.*PENDING/.test(details)) {
    return failure('CONFIRMATION_DELAYED')
  }
  if (/TIMEOUT|TIMED OUT|ABORTERROR/.test(details)) return failure('REQUEST_TIMEOUT')
  if (/NETWORK_ERROR|NETWORK FAILURE|FAILED TO FETCH|FETCH FAILED|OFFLINE|CONNECTION/.test(details)) {
    return failure('NETWORK_FAILURE')
  }

  return failure('UNKNOWN')
}

export function successfulWalletOutcome<T>(value: T): WalletOutcome<T> {
  return { status: 'success', value }
}

import {
  AuthErrorResponseSchema,
  WalletChallengeResponseSchema,
  WalletSessionResponseSchema,
  type WalletSessionResponse,
} from '@nimtrace/contracts'
import { nimiqPayWallet, type NimiqPayWalletAdapter } from './wallet'

interface AuthenticationError {
  code: string
  message: string
  retryable: boolean
}

export type WalletAuthenticationOutcome =
  | { status: 'success'; session: WalletSessionResponse }
  | { status: 'cancelled' }
  | { status: 'error'; error: AuthenticationError }

interface AuthenticationOptions {
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>
  wallet?: Pick<NimiqPayWalletAdapter, 'connect' | 'sign'>
}

function failure(code: string, message: string, retryable = true): WalletAuthenticationOutcome {
  return { status: 'error', error: { code, message, retryable } }
}

async function serverFailure(response: Response): Promise<WalletAuthenticationOutcome> {
  const parsed = AuthErrorResponseSchema.safeParse(await response.json().catch(() => null))
  if (parsed.success) {
    return failure(parsed.data.error, parsed.data.message, parsed.data.recoverable)
  }
  return failure('internal_error', 'NimTrace could not complete wallet sign-in.')
}

export async function authenticateWallet(
  options: AuthenticationOptions = {},
): Promise<WalletAuthenticationOutcome> {
  const wallet = options.wallet ?? nimiqPayWallet
  const fetcher = options.fetcher ?? fetch
  const connection = await wallet.connect()

  if (connection.status === 'cancelled') return { status: 'cancelled' }
  if (connection.status === 'error') {
    return failure(connection.error.code, connection.error.message, connection.error.retryable)
  }

  try {
    const challengeResponse = await fetcher('/api/auth/challenges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress: connection.value.address }),
    })
    if (!challengeResponse.ok) return serverFailure(challengeResponse)
    const challenge = WalletChallengeResponseSchema.parse(await challengeResponse.json())

    const signature = await wallet.sign(challenge.message)
    if (signature.status === 'cancelled') return { status: 'cancelled' }
    if (signature.status === 'error') {
      return failure(signature.error.code, signature.error.message, signature.error.retryable)
    }

    const sessionResponse = await fetcher('/api/auth/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        network: challenge.network,
        publicKey: signature.value.publicKey,
        signature: signature.value.signature,
        walletAddress: challenge.walletAddress,
      }),
    })
    if (!sessionResponse.ok) return serverFailure(sessionResponse)

    return {
      status: 'success',
      session: WalletSessionResponseSchema.parse(await sessionResponse.json()),
    }
  } catch {
    return failure('network_failure', 'Wallet sign-in failed. Check your connection and try again.')
  }
}

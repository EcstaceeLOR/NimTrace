import { Hono } from 'hono'
import {
  HealthResponseSchema,
  NimiqNetworkSchema,
  WalletChallengeRequestSchema,
  WalletSessionRequestSchema,
} from '@nimtrace/contracts'
import { AuthServiceError, createWalletSession, issueWalletChallenge } from './auth/service'

interface Bindings {
  APP_VERSION?: string
  DB: D1Database
  ENVIRONMENT?: string
  NIMIQ_NETWORK?: string
}

export const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => c.json({ service: 'nimtrace-api', docs: '/api/health' }))

app.get('/api/health', (c) => {
  const health = HealthResponseSchema.parse({
    status: 'ok',
    service: 'nimtrace-api',
    version: c.env?.APP_VERSION ?? '0.1.0',
    environment: c.env?.ENVIRONMENT ?? 'unknown',
    timestamp: new Date().toISOString(),
  })

  return c.json(health, 200, {
    'Cache-Control': 'no-store',
  })
})

function networkFromEnvironment(value: string | undefined) {
  return NimiqNetworkSchema.parse(value ?? 'main-albatross')
}

app.post('/api/auth/challenges', async (c) => {
  const payload = WalletChallengeRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!payload.success) {
    return c.json({
      error: 'invalid_request' as const,
      message: 'A valid walletAddress is required.',
      recoverable: true,
    }, 400)
  }

  const challenge = await issueWalletChallenge(
    c.env.DB,
    payload.data.walletAddress,
    networkFromEnvironment(c.env.NIMIQ_NETWORK),
  )
  return c.json(challenge, 201, { 'Cache-Control': 'no-store' })
})

app.post('/api/auth/sessions', async (c) => {
  const payload = WalletSessionRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!payload.success) {
    return c.json({
      error: 'invalid_request' as const,
      message: 'The signed challenge response is malformed.',
      recoverable: true,
    }, 400)
  }

  const session = await createWalletSession(
    c.env.DB,
    payload.data,
    networkFromEnvironment(c.env.NIMIQ_NETWORK),
  )
  return c.json(session, 201, { 'Cache-Control': 'no-store' })
})

app.notFound((c) => c.json({ error: 'not_found', message: 'Route not found' }, 404))

app.onError((error, c) => {
  if (error instanceof AuthServiceError) {
    return c.json({
      error: error.code,
      message: error.message,
      recoverable: error.recoverable,
    }, error.status)
  }

  console.error('Unhandled API error', error)
  return c.json({
    error: 'internal_error' as const,
    message: 'The request could not be completed',
    recoverable: true,
  }, 500)
})

export default app

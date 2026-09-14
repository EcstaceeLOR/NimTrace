import { Hono } from 'hono'
import { HealthResponseSchema } from '@nimtrace/contracts'

interface Bindings {
  APP_VERSION?: string
  DB: D1Database
  ENVIRONMENT?: string
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

app.notFound((c) => c.json({ error: 'not_found', message: 'Route not found' }, 404))

app.onError((error, c) => {
  console.error('Unhandled API error', error)
  return c.json({ error: 'internal_error', message: 'The request could not be completed' }, 500)
})

export default app

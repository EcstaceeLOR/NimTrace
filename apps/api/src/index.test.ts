import { describe, expect, it } from 'vitest'
import { HealthResponseSchema } from '@nimtrace/contracts'
import { app } from './index'

describe('GET /api/health', () => {
  it('returns a no-store, contract-valid health response', async () => {
    const response = await app.request('/api/health', undefined, {
      APP_VERSION: 'test',
      ENVIRONMENT: 'test',
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(HealthResponseSchema.parse(await response.json())).toMatchObject({
      status: 'ok',
      service: 'nimtrace-api',
      version: 'test',
      environment: 'test',
    })
  })
})

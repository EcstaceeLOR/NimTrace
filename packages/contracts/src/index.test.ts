import { describe, expect, it } from 'vitest'
import { HealthResponseSchema, ProductPassportStatusSchema } from './index'

describe('shared contracts', () => {
  it('accepts known passport lifecycle states', () => {
    expect(ProductPassportStatusSchema.parse('owned')).toBe('owned')
  })

  it('rejects malformed health timestamps', () => {
    expect(() => HealthResponseSchema.parse({
      status: 'ok',
      service: 'nimtrace-api',
      version: '0.1.0',
      environment: 'test',
      timestamp: 'today',
    })).toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import { formatNimFromLuna, nimToLuna } from './nim'

describe('NIM and Luna formatting', () => {
  it.each([
    ['1', 100000],
    ['0.00001', 1],
    ['12.34567', 1234567],
    ['1.2', 120000],
  ])('converts %s NIM to exact integer Luna', (nim, luna) => {
    expect(nimToLuna(nim)).toBe(luna)
  })

  it.each(['1.000001', '0', '-1', '1e3', '1,25', '0.000001'])('rejects unsafe amount %s', (value) => {
    expect(() => nimToLuna(value)).toThrow()
  })

  it('formats Luna without floating-point arithmetic', () => {
    expect(formatNimFromLuna(1234567)).toBe('12.34567 NIM')
    expect(formatNimFromLuna(100000)).toBe('1 NIM')
  })
})

const LUNA_PER_NIM = 100_000n

export function nimToLuna(value: string): number {
  const normalized = value.trim()
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,5}))?$/.exec(normalized)
  if (!match?.[1]) throw new Error('Enter a positive NIM amount with no more than 5 decimals.')

  const whole = BigInt(match[1])
  const fraction = BigInt((match[2] ?? '').padEnd(5, '0'))
  const luna = whole * LUNA_PER_NIM + fraction
  if (luna <= 0n || luna > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Enter a NIM amount within the supported range.')
  }
  return Number(luna)
}

export function formatNimFromLuna(valueLuna: number): string {
  if (!Number.isSafeInteger(valueLuna) || valueLuna < 0) throw new Error('Invalid Luna amount.')
  const whole = Math.floor(valueLuna / Number(LUNA_PER_NIM))
  const fraction = String(valueLuna % Number(LUNA_PER_NIM)).padStart(5, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction} NIM` : `${whole} NIM`
}

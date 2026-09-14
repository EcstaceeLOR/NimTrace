import { z } from 'zod'

type NimiqNetwork = 'main-albatross' | 'test-albatross'
const proofNetworkSchema = z.enum(['main-albatross', 'test-albatross'])

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]))

export const ProofActionSchema = z.enum([
  'ISSUE_PRODUCT',
  'UPDATE_PRODUCT',
  'OFFER_TRANSFER',
  'ACCEPT_TRANSFER',
  'CLAIM_WARRANTY',
  'ATTEST_REPAIR',
  'ACKNOWLEDGE_REPAIR',
])

export type ProofAction = z.infer<typeof ProofActionSchema>

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)

export const ProofEnvelopeSchema = z.object({
  action: ProofActionSchema,
  app: z.literal('nimtrace'),
  expiresAt: z.iso.datetime(),
  issuedAt: z.iso.datetime(),
  network: proofNetworkSchema,
  nonce: z.string().min(16).max(128),
  payloadHash: sha256Schema,
  previousEventHash: z.union([sha256Schema, z.null()]),
  summary: z.string().trim().min(1).max(240),
  version: z.literal(1),
}).strict().refine(
  ({ expiresAt, issuedAt }) => Date.parse(expiresAt) > Date.parse(issuedAt),
  { message: 'expiresAt must be later than issuedAt', path: ['expiresAt'] },
)

export type ProofEnvelope = z.infer<typeof ProofEnvelopeSchema>

export const SignedProofSchema = z.object({
  envelope: ProofEnvelopeSchema,
  payload: JsonValueSchema,
  publicKey: z.string().regex(/^[a-f0-9]{64}$/i),
  signature: z.string().regex(/^[a-f0-9]{128}$/i),
}).strict()

export type SignedProof = z.infer<typeof SignedProofSchema>

export interface CreateProofEnvelopeInput {
  action: ProofAction
  expiresAt: string
  issuedAt: string
  network: NimiqNetwork
  nonce: string
  payloadHash: string
  previousEventHash: string | null
  summary: string
}

function canonicalize(value: unknown, seen: Set<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON does not support non-finite numbers')
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') throw new TypeError(`Canonical JSON does not support ${typeof value}`)
  if (seen.has(value)) throw new TypeError('Canonical JSON does not support cyclic values')

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const items = Array.from(
        { length: value.length },
        (_unused, index) => canonicalize(value[index], seen),
      )
      return `[${items.join(',')}]`
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Canonical JSON supports only plain objects and arrays')
    }

    const record = value as Record<string, unknown>
    const entries = Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalize(record[key], seen)}`
    ))
    return `{${entries.join(',')}}`
  } finally {
    seen.delete(value)
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set())
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return bytesToHex(new Uint8Array(digest))
}

export function canonicalPayload(payload: JsonValue): string {
  return canonicalJson({ data: payload, version: 1 })
}

export async function hashCanonicalPayload(payload: JsonValue): Promise<string> {
  return sha256Hex(canonicalPayload(payload))
}

export function createProofEnvelope(input: CreateProofEnvelopeInput): ProofEnvelope {
  return ProofEnvelopeSchema.parse({ app: 'nimtrace', version: 1, ...input })
}

export function proofSigningMessage(envelope: ProofEnvelope): string {
  const parsed = ProofEnvelopeSchema.parse(envelope)
  return [
    'NimTrace signed action',
    '',
    parsed.summary,
    '',
    'Review the details below. This signature does not send NIM.',
    '',
    canonicalJson(parsed),
  ].join('\n')
}

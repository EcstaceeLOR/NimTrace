import { verifyAsync } from '@noble/ed25519'
import { blake2b } from '@noble/hashes/blake2.js'
import { nimiqSignedMessageDigest } from './message'

const NIMIQ_BASE32 = '0123456789ABCDEFGHJKLMNPQRSTUVXY'

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return bytesToHex(new Uint8Array(digest))
}

export function randomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function ibanRemainder(value: string): number {
  const rearranged = `${value.slice(4)}${value.slice(0, 4)}`
  let remainder = 0
  for (const character of rearranged) {
    const expanded = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character
    for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder
}

function formatAddress(compact: string): string {
  return compact.match(/.{1,4}/g)?.join(' ') ?? compact
}

export function normalizeNimiqAddress(value: string): string {
  const compact = value.replace(/\s/g, '').toUpperCase()
  if (!/^NQ\d{2}[0-9A-HJ-NP-VXY]{32}$/.test(compact) || ibanRemainder(compact) !== 1) {
    throw new Error('Invalid Nimiq address')
  }
  return formatAddress(compact)
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) throw new Error('Invalid hex value')
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16))
}

function publicKeyAddress(publicKey: Uint8Array): string {
  const bytes = blake2b(publicKey, { dkLen: 32 }).slice(0, 20)
  let bits = 0
  let buffer = 0
  let body = ''
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      body += NIMIQ_BASE32[(buffer >>> bits) & 31]
    }
  }
  const provisional = `NQ00${body}`
  const checksum = String(98 - ibanRemainder(provisional)).padStart(2, '0')
  return formatAddress(`NQ${checksum}${body}`)
}

interface SignatureVerification {
  address: string
  valid: boolean
}

export async function verifyWalletSignature(
  message: string,
  publicKeyHex: string,
  signatureHex: string,
): Promise<SignatureVerification | null> {
  try {
    const publicKey = hexToBytes(publicKeyHex)
    const signature = hexToBytes(signatureHex)
    if (publicKey.length !== 32 || signature.length !== 64) return null
    const digest = await nimiqSignedMessageDigest(message)
    return {
      address: publicKeyAddress(publicKey),
      valid: await verifyAsync(signature, digest, publicKey),
    }
  } catch {
    return null
  }
}

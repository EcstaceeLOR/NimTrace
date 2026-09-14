import { Address, PublicKey, Signature } from '@nimiq/core'
import { nimiqSignedMessageDigest } from './message'

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

export function normalizeNimiqAddress(value: string): string {
  const address = Address.fromString(value.trim())
  try {
    return address.toUserFriendlyAddress()
  } finally {
    address.free()
  }
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
  let publicKey: PublicKey | undefined
  let signature: Signature | undefined
  let address: Address | undefined

  try {
    publicKey = PublicKey.fromHex(publicKeyHex)
    signature = Signature.fromHex(signatureHex)
    address = publicKey.toAddress()
    const digest = await nimiqSignedMessageDigest(message)
    return {
      address: address.toUserFriendlyAddress(),
      valid: publicKey.verify(signature, digest),
    }
  } catch {
    return null
  } finally {
    address?.free()
    signature?.free()
    publicKey?.free()
  }
}

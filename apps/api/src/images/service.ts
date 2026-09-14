import { sha256Hex } from '@nimtrace/contracts'
import { randomToken } from '../auth/crypto'

export const DEMO_IMAGE_KEY = 'demo/nimtrace-product-v1.svg'
export const DEMO_IMAGE_HASH = 'ecdd3da520f6f9e9df63058c4cdca6e6ed69306cc77f82bf35b12a0907676832'
const MAX_IMAGE_BYTES = 1_500_000
const MIN_DIMENSION = 64
const MAX_DIMENSION = 1600

export class ProductImageError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 413 | 415,
  ) {
    super(message)
  }
}

function uint24(bytes: Uint8Array, offset: number) {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
}

function uint32(bytes: Uint8Array, offset: number) {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
    | (bytes[offset + 3]! << 24)) >>> 0
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}

export function inspectWebP(bytes: Uint8Array) {
  if (bytes.byteLength < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') {
    throw new ProductImageError('invalid_image_content', 'The uploaded bytes are not a valid WebP image.', 415)
  }
  if (uint32(bytes, 4) + 8 !== bytes.byteLength) {
    throw new ProductImageError('invalid_image_content', 'The WebP container length is invalid.', 415)
  }

  let offset = 12
  let dimensions: { height: number; width: number } | undefined
  let imageChunk = false
  while (offset + 8 <= bytes.byteLength) {
    const type = ascii(bytes, offset, 4)
    const size = uint32(bytes, offset + 4)
    const payload = offset + 8
    const next = payload + size + (size % 2)
    if (next > bytes.byteLength) {
      throw new ProductImageError('invalid_image_content', 'The WebP image is truncated.', 415)
    }

    if (type === 'VP8X' && size >= 10) {
      dimensions = { width: uint24(bytes, payload + 4) + 1, height: uint24(bytes, payload + 7) + 1 }
    } else if (type === 'VP8 ' && size >= 10) {
      if (bytes[payload + 3] !== 0x9d || bytes[payload + 4] !== 0x01 || bytes[payload + 5] !== 0x2a) {
        throw new ProductImageError('invalid_image_content', 'The WebP frame header is invalid.', 415)
      }
      dimensions ??= {
        width: (bytes[payload + 6]! | (bytes[payload + 7]! << 8)) & 0x3fff,
        height: (bytes[payload + 8]! | (bytes[payload + 9]! << 8)) & 0x3fff,
      }
      imageChunk = true
    } else if (type === 'VP8L' && size >= 5) {
      if (bytes[payload] !== 0x2f) {
        throw new ProductImageError('invalid_image_content', 'The lossless WebP header is invalid.', 415)
      }
      const bits = uint32(bytes, payload + 1)
      dimensions ??= { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
      imageChunk = true
    }
    offset = next
  }

  if (offset !== bytes.byteLength || !dimensions || !imageChunk) {
    throw new ProductImageError('invalid_image_content', 'The WebP image has no complete image frame.', 415)
  }
  if (
    dimensions.width < MIN_DIMENSION || dimensions.height < MIN_DIMENSION
    || dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION
  ) {
    throw new ProductImageError(
      'invalid_image_dimensions',
      `Images must be between ${MIN_DIMENSION} and ${MAX_DIMENSION} pixels on each side.`,
      400,
    )
  }
  return dimensions
}

async function sha256Bytes(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function storeProductImage(
  bucket: R2Bucket | undefined,
  walletAddress: string,
  contentType: string | undefined,
  body: ArrayBuffer,
) {
  if (contentType !== 'image/webp') {
    throw new ProductImageError(
      'unsupported_image_type',
      'Only client-processed WebP images are accepted. SVG and animated formats are rejected.',
      415,
    )
  }
  if (body.byteLength === 0 || body.byteLength > MAX_IMAGE_BYTES) {
    throw new ProductImageError('image_too_large', 'Processed images must be smaller than 1.5 MB.', 413)
  }

  const bytes = new Uint8Array(body)
  const dimensions = inspectWebP(bytes)
  const imageHash = await sha256Bytes(body)
  const walletPath = (await sha256Hex(walletAddress)).slice(0, 16)
  const imageKey = `products/${walletPath}/${randomToken(18)}/${imageHash}.webp`

  try {
    if (!bucket) throw new Error('R2 binding is unavailable')
    await bucket.put(imageKey, body, {
      httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: {
        contentHash: imageHash,
        height: String(dimensions.height),
        ownerPath: walletPath,
        width: String(dimensions.width),
      },
    })
    return {
      bytes: body.byteLength,
      fallback: false,
      height: dimensions.height,
      imageHash,
      imageKey,
      url: `/api/product-images?key=${encodeURIComponent(imageKey)}`,
      width: dimensions.width,
    }
  } catch {
    return {
      bytes: 0,
      fallback: true,
      height: 800,
      imageHash: DEMO_IMAGE_HASH,
      imageKey: DEMO_IMAGE_KEY,
      url: '/demo-product.svg',
      width: 800,
    }
  }
}

export async function deleteProductImage(
  bucket: R2Bucket | undefined,
  walletAddress: string,
  imageKey: string,
) {
  if (imageKey === DEMO_IMAGE_KEY) return
  const walletPath = (await sha256Hex(walletAddress)).slice(0, 16)
  if (!imageKey.startsWith(`products/${walletPath}/`)) {
    throw new ProductImageError('invalid_image_key', 'This image does not belong to the active wallet.', 400)
  }
  await bucket?.delete(imageKey)
}

export async function validateProductImageReference(
  bucket: R2Bucket | undefined,
  walletAddress: string,
  imageKey: string,
  imageHash: string,
) {
  if (imageKey === DEMO_IMAGE_KEY) {
    if (imageHash !== DEMO_IMAGE_HASH) {
      throw new ProductImageError('invalid_image_reference', 'The demo image hash is invalid.', 400)
    }
    return
  }

  const walletPath = (await sha256Hex(walletAddress)).slice(0, 16)
  if (!imageKey.startsWith(`products/${walletPath}/`) || !imageKey.endsWith(`/${imageHash}.webp`)) {
    throw new ProductImageError('invalid_image_reference', 'The product image reference is invalid.', 400)
  }
  const object = await bucket?.head(imageKey)
  if (!object || object.customMetadata?.contentHash !== imageHash) {
    throw new ProductImageError('invalid_image_reference', 'Upload the processed product image before signing.', 400)
  }
}

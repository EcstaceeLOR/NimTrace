import { describe, expect, it, vi } from 'vitest'
import {
  DEMO_IMAGE_HASH,
  DEMO_IMAGE_KEY,
  inspectWebP,
  storeProductImage,
  validateProductImageReference,
} from './service'

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index)
}

function webp(width = 640, height = 480) {
  const bytes = new Uint8Array(30)
  const view = new DataView(bytes.buffer)
  writeAscii(bytes, 0, 'RIFF')
  view.setUint32(4, 22, true)
  writeAscii(bytes, 8, 'WEBP')
  writeAscii(bytes, 12, 'VP8 ')
  view.setUint32(16, 10, true)
  bytes.set([0, 0, 0, 0x9d, 0x01, 0x2a], 20)
  view.setUint16(26, width, true)
  view.setUint16(28, height, true)
  return bytes
}

function jpeg(width = 640, height = 480) {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ])
}

describe('safe product image storage', () => {
  it('validates decoded WebP dimensions and stores by hash under an unguessable path', async () => {
    const put = vi.fn().mockResolvedValue(undefined)
    const bytes = webp()
    const result = await storeProductImage(
      { put } as unknown as R2Bucket,
      'NQ12 TEST WALLET ADDRESS',
      'image/webp',
      bytes.buffer,
    )

    expect(result).toMatchObject({ bytes: 30, fallback: false, height: 480, width: 640 })
    expect(result.imageKey).toMatch(/^products\/[a-f0-9]{16}\/[A-Za-z0-9_-]{24}\/[a-f0-9]{64}\.webp$/)
    expect(result.imageKey).toContain(result.imageHash)
    expect(put).toHaveBeenCalledWith(
      result.imageKey,
      bytes.buffer,
      expect.objectContaining({
        httpMetadata: expect.objectContaining({ contentType: 'image/webp' }),
        customMetadata: expect.objectContaining({ contentHash: result.imageHash, height: '480', width: '640' }),
      }),
    )
  })

  it('stores a validated JPEG fallback when WebP encoding is unavailable', async () => {
    const put = vi.fn().mockResolvedValue(undefined)
    const bytes = jpeg()
    const result = await storeProductImage(
      { put } as unknown as R2Bucket,
      'NQ12 TEST WALLET ADDRESS',
      'image/jpeg',
      bytes.buffer,
    )

    expect(result).toMatchObject({ bytes: bytes.byteLength, fallback: false, height: 480, width: 640 })
    expect(result.imageKey).toMatch(/\.jpg$/)
    expect(put).toHaveBeenCalledWith(result.imageKey, bytes.buffer, expect.objectContaining({ httpMetadata: expect.objectContaining({ contentType: 'image/jpeg' }) }))
  })

  it('rejects spoofed, truncated, active, oversized, and invalid-dimension inputs', async () => {
    expect(() => inspectWebP(new Uint8Array(30))).toThrow(/not a valid WebP/)
    const truncated = webp()
    new DataView(truncated.buffer).setUint32(4, 100, true)
    expect(() => inspectWebP(truncated)).toThrow(/container length/)
    expect(() => inspectWebP(webp(2000, 480))).toThrow(/between 64 and 1600/)

    await expect(storeProductImage(
      undefined,
      'NQ12 TEST WALLET ADDRESS',
      'image/svg+xml',
      webp().buffer,
    )).rejects.toMatchObject({ code: 'unsupported_image_type', status: 415 })
    await expect(storeProductImage(
      undefined,
      'NQ12 TEST WALLET ADDRESS',
      'image/webp',
      new ArrayBuffer(1_500_001),
    )).rejects.toMatchObject({ code: 'image_too_large', status: 413 })
  })

  it('fails explicitly when the R2 binding is missing', async () => {
    await expect(storeProductImage(
      undefined,
      'NQ12 TEST WALLET ADDRESS',
      'image/webp',
      webp().buffer,
    )).rejects.toMatchObject({
      code: 'image_storage_unavailable',
      status: 503,
    })
  })

  it('fails explicitly when R2 rejects a write instead of publishing the demo image', async () => {
    const bucket = { put: vi.fn().mockRejectedValue(new Error('R2 unavailable')) } as unknown as R2Bucket

    await expect(storeProductImage(
      bucket,
      'NQ12 TEST WALLET ADDRESS',
      'image/webp',
      webp().buffer,
    )).rejects.toMatchObject({
      code: 'image_storage_unavailable',
      status: 503,
    })
  })

  it('allows signing only the stored final content hash or exact legacy demo fallback', async () => {
    const imageHash = 'c'.repeat(64)
    const walletAddress = 'NQ12 TEST WALLET ADDRESS'
    const stored = await storeProductImage(
      { put: vi.fn().mockResolvedValue(undefined) } as unknown as R2Bucket,
      walletAddress,
      'image/webp',
      webp().buffer,
    )
    const bucket = {
      head: vi.fn().mockResolvedValue({ customMetadata: { contentHash: stored.imageHash } }),
    } as unknown as R2Bucket

    await expect(validateProductImageReference(
      bucket,
      walletAddress,
      stored.imageKey,
      stored.imageHash,
    )).resolves.toBeUndefined()
    await expect(validateProductImageReference(
      bucket,
      walletAddress,
      stored.imageKey.replace(stored.imageHash, imageHash),
      imageHash,
    )).rejects.toMatchObject({ code: 'invalid_image_reference' })
    await expect(validateProductImageReference(
      undefined,
      walletAddress,
      DEMO_IMAGE_KEY,
      DEMO_IMAGE_HASH,
    )).resolves.toBeUndefined()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { processProductImage, validateProductImageFile } from './productImage'

describe('product image source validation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])('accepts camera-safe type %s', (type) => {
    expect(() => validateProductImageFile({ size: 500_000, type })).not.toThrow()
  })

  it.each(['image/svg+xml', 'image/gif', 'text/html', ''])('rejects active or unsupported type %s', (type) => {
    expect(() => validateProductImageFile({ size: 1000, type })).toThrow(/JPEG, PNG, WebP, or HEIC/)
  })

  it('rejects empty and oversized source files', () => {
    expect(() => validateProductImageFile({ size: 0, type: 'image/jpeg' })).toThrow(/smaller than 10 MB/)
    expect(() => validateProductImageFile({ size: 10_000_001, type: 'image/jpeg' })).toThrow(/smaller than 10 MB/)
  })

  it('decodes, scales down, and re-encodes a camera image as WebP', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 3200, height: 1600, close }))
    const drawImage = vi.fn()
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      if (tagName !== 'canvas') return originalCreateElement(tagName, options)
      return {
        getContext: () => ({ drawImage }),
        height: 0,
        toBlob: (callback: BlobCallback, type?: string) => callback(new Blob(['safe-webp'], { type })),
        width: 0,
      } as unknown as HTMLCanvasElement
    })

    const result = await processProductImage(new File(['camera-bytes'], 'camera.jpg', { type: 'image/jpeg' }))

    expect(result.type).toBe('image/webp')
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 800)
    expect(close).toHaveBeenCalled()
  })

  it('falls back to JPEG when the device cannot encode WebP', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 640, height: 480, close }))
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      if (tagName !== 'canvas') return originalCreateElement(tagName, options)
      return {
        getContext: () => ({ drawImage: vi.fn() }),
        height: 0,
        toBlob: (callback: BlobCallback, type?: string) => callback(type === 'image/jpeg' ? new Blob(['safe-jpeg'], { type }) : null),
        width: 0,
      } as unknown as HTMLCanvasElement
    })

    const result = await processProductImage(new File(['camera-bytes'], 'camera.jpg', { type: 'image/jpeg' }))

    expect(result.type).toBe('image/jpeg')
    expect(close).toHaveBeenCalled()
  })
})

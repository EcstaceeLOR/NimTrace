import { afterEach, describe, expect, it, vi } from 'vitest'
import { processProductImage, validateProductImageFile } from './productImage'

describe('product image source validation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts camera-safe type %s', (type) => {
    expect(() => validateProductImageFile({ size: 500_000, type })).not.toThrow()
  })

  it.each(['image/svg+xml', 'image/gif', 'text/html', ''])('rejects active or unsupported type %s', (type) => {
    expect(() => validateProductImageFile({ size: 1000, type })).toThrow(/JPEG, PNG, or WebP/)
  })

  it.each(['image/heic', 'image/heif'])('rejects unreliable WebView type %s with an actionable message', (type) => {
    expect(() => validateProductImageFile({ size: 1000, type })).toThrow(/export the photo as JPEG, PNG, or WebP/)
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

  it('falls back to the regular image decoder when createImageBitmap fails', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')))
    const revokeObjectURL = vi.fn()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL)

    class FakeImage {
      decoding = 'auto'
      naturalWidth = 800
      naturalHeight = 600
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) { queueMicrotask(() => this.onload?.()) }
    }
    vi.stubGlobal('Image', FakeImage)

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
    expect(drawImage).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test')
  })

  it('reports an actionable error when neither decoder can read the image', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')))
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    class FakeImage {
      decoding = 'auto'
      naturalWidth = 0
      naturalHeight = 0
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) { queueMicrotask(() => this.onerror?.()) }
    }
    vi.stubGlobal('Image', FakeImage)

    await expect(processProductImage(new File(['bad'], 'bad.jpg', { type: 'image/jpeg' })))
      .rejects.toThrow(/could not be decoded on this device/)
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

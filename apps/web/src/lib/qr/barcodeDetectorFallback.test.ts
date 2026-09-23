import { afterEach, describe, expect, it, vi } from 'vitest'
import { installQrBarcodeDetectorFallback } from './barcodeDetectorFallback'

interface DetectorWindow extends Window {
  BarcodeDetector?: new (options: { formats: string[] }) => {
    detect(source: ImageBitmap): Promise<Array<{ rawValue?: string }>>
  }
}

describe('QR BarcodeDetector fallback', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps the native BarcodeDetector when the WebView provides one', () => {
    class NativeDetector {
      constructor(_options: { formats: string[] }) {}
      async detect() { return [{ rawValue: 'native' }] }
    }
    const target = { BarcodeDetector: NativeDetector } as unknown as DetectorWindow
    const installed = installQrBarcodeDetectorFallback(target)

    expect(installed).toBe(false)
    expect(target.BarcodeDetector).toBe(NativeDetector)
  })

  it('decodes QR pixels with the JavaScript fallback', async () => {
    const drawImage = vi.fn()
    const getImageData = vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4 * 100 * 100) })
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      if (tagName !== 'canvas') return originalCreateElement(tagName, options)
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage, getImageData }),
      } as unknown as HTMLCanvasElement
    })
    const decoder = vi.fn().mockReturnValue({ data: 'https://nimtrace.vercel.app/passports/passport-123' })
    const target = {} as DetectorWindow

    expect(installQrBarcodeDetectorFallback(target, async () => decoder)).toBe(true)
    const Detector = target.BarcodeDetector!
    const detector = new Detector({ formats: ['qr_code'] })
    const result = await detector.detect({ width: 100, height: 100 } as ImageBitmap)

    expect(result).toEqual([{ rawValue: 'https://nimtrace.vercel.app/passports/passport-123' }])
    expect(decoder).toHaveBeenCalledWith(expect.any(Uint8ClampedArray), 100, 100, { inversionAttempts: 'attemptBoth' })
    expect(drawImage).toHaveBeenCalled()
  })

  it('returns no detections when the JavaScript decoder finds no QR', async () => {
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      if (tagName !== 'canvas') return originalCreateElement(tagName, options)
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: vi.fn(),
          getImageData: () => ({ data: new Uint8ClampedArray(4 * 32 * 32) }),
        }),
      } as unknown as HTMLCanvasElement
    })
    const target = {} as DetectorWindow
    installQrBarcodeDetectorFallback(target, async () => vi.fn().mockReturnValue(null))

    const detector = new target.BarcodeDetector!({ formats: ['qr_code'] })
    await expect(detector.detect({ width: 32, height: 32 } as ImageBitmap)).resolves.toEqual([])
  })

  it('rejects unsupported detector formats', () => {
    const target = {} as DetectorWindow
    installQrBarcodeDetectorFallback(target, async () => vi.fn())
    const Detector = target.BarcodeDetector!
    expect(() => new Detector({ formats: ['code_128'] })).toThrow(/Only QR code/)
  })
})

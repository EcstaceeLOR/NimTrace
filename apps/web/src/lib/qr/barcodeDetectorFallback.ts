type BarcodeResult = { rawValue?: string }

type BarcodeDetectorLike = new (options: { formats: string[] }) => {
  detect(source: ImageBitmap): Promise<BarcodeResult[]>
}

type JsQrDecoder = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: 'attemptBoth' | 'dontInvert' | 'onlyInvert' | 'invertFirst' },
) => { data: string } | null

type JsQrLoader = () => Promise<JsQrDecoder>

const JSQR_MODULE_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm'
const MAX_QR_DECODE_EDGE = 1800

async function loadPinnedJsQr(): Promise<JsQrDecoder> {
  const moduleUrl = JSQR_MODULE_URL
  const imported = await import(/* @vite-ignore */ moduleUrl) as { default?: unknown }
  if (typeof imported.default !== 'function') {
    throw new Error('The QR decoder could not be loaded.')
  }
  return imported.default as JsQrDecoder
}

function createFallbackDetector(loader: JsQrLoader): BarcodeDetectorLike {
  return class QrBarcodeDetectorFallback {
    constructor(options: { formats: string[] }) {
      if (!options.formats.includes('qr_code')) {
        throw new Error('Only QR code detection is supported by this fallback.')
      }
    }

    async detect(source: ImageBitmap): Promise<BarcodeResult[]> {
      const sourceWidth = source.width
      const sourceHeight = source.height
      if (!sourceWidth || !sourceHeight) return []

      const scale = Math.min(1, MAX_QR_DECODE_EDGE / Math.max(sourceWidth, sourceHeight))
      const width = Math.max(1, Math.round(sourceWidth * scale))
      const height = Math.max(1, Math.round(sourceHeight * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('QR decoding is unavailable on this device.')
      context.drawImage(source, 0, 0, width, height)
      const image = context.getImageData(0, 0, width, height)
      const decode = await loader()
      const result = decode(image.data, width, height, { inversionAttempts: 'attemptBoth' })
      return result?.data ? [{ rawValue: result.data }] : []
    }
  }
}

export function installQrBarcodeDetectorFallback(
  target: Window & { BarcodeDetector?: BarcodeDetectorLike } = window,
  loader: JsQrLoader = loadPinnedJsQr,
) {
  if (target.BarcodeDetector) return false
  target.BarcodeDetector = createFallbackDetector(loader)
  return true
}

import { ProductImageResponseSchema, type ProductImageResponse } from '@nimtrace/contracts'

const SOURCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_SOURCE_BYTES = 10_000_000
const MAX_SOURCE_DIMENSION = 12_000
const MAX_SOURCE_PIXELS = 40_000_000
const OUTPUT_DIMENSION = 1600

interface DecodedImage {
  close(): void
  height: number
  source: CanvasImageSource
  width: number
}

export function validateProductImageFile(file: Pick<File, 'size' | 'type'>) {
  if (!SOURCE_TYPES.has(file.type)) {
    if (file.type === 'image/heic' || file.type === 'image/heif') {
      throw new Error('HEIC/HEIF is not reliably supported inside Nimiq Pay yet. Choose or export the photo as JPEG, PNG, or WebP and retry.')
    }
    throw new Error('Choose a JPEG, PNG, or WebP image. SVG, GIF, HEIC, and other unsupported formats are not accepted.')
  }
  if (file.size === 0 || file.size > MAX_SOURCE_BYTES) {
    throw new Error('Choose an image smaller than 10 MB.')
  }
}

async function decodeWithImageElement(file: File): Promise<DecodedImage> {
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.decoding = 'async'

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('decode_failed'))
      image.src = url
    })
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('decode_failed')
    return {
      close: () => URL.revokeObjectURL(url),
      height: image.naturalHeight,
      source: image,
      width: image.naturalWidth,
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

async function decodeProductImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return {
        close: () => bitmap.close(),
        height: bitmap.height,
        source: bitmap,
        width: bitmap.width,
      }
    } catch {
      // Older embedded WebViews can expose createImageBitmap but fail on files
      // the regular image decoder can still render, so try that path next.
    }
  }

  try {
    return await decodeWithImageElement(file)
  } catch {
    throw new Error('This image could not be decoded on this device. Choose a JPEG, PNG, or WebP photo and retry.')
  }
}

export async function processProductImage(file: File): Promise<Blob> {
  validateProductImageFile(file)
  const decoded = await decodeProductImage(file)

  try {
    if (
      decoded.width < 64 || decoded.height < 64
      || decoded.width > MAX_SOURCE_DIMENSION || decoded.height > MAX_SOURCE_DIMENSION
      || decoded.width * decoded.height > MAX_SOURCE_PIXELS
    ) {
      throw new Error('Choose an image between 64px and 12,000px with at most 40 megapixels.')
    }

    const scale = Math.min(1, OUTPUT_DIMENSION / Math.max(decoded.width, decoded.height))
    const width = Math.round(decoded.width * scale)
    const height = Math.round(decoded.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('Image processing is unavailable on this device.')
    context.drawImage(decoded.source, 0, 0, width, height)

    const output = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', 0.84)
    })
    if (output?.type === 'image/webp' && output.size <= 1_500_000) {
      return output
    }

    // Some embedded WebViews cannot encode WebP. JPEG is safe after the same
    // pixel checks and remains accepted by the API.
    const fallback = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.82)
    })
    if (fallback?.type === 'image/jpeg' && fallback.size <= 1_500_000) {
      return fallback
    }
    if (output?.size && output.size > 1_500_000) {
      throw new Error('The processed image is larger than 1.5 MB. Choose a simpler image.')
    }
    throw new Error('This device could not create a safe image. Choose an existing JPEG or PNG file and retry.')
  } finally {
    decoded.close()
  }
}

export function uploadProductImage(
  image: Blob,
  sessionToken: string,
  onProgress: (percent: number) => void,
): Promise<ProductImageResponse> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', '/api/product-images')
    request.setRequestHeader('Authorization', `Bearer ${sessionToken}`)
    request.setRequestHeader('Content-Type', image.type)
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    })
    request.addEventListener('load', () => {
      let body: unknown
      try {
        body = JSON.parse(request.responseText)
      } catch {
        reject(new Error('The image service returned an invalid response.'))
        return
      }
      if (request.status < 200 || request.status >= 300) {
        const message = typeof body === 'object' && body !== null && 'message' in body
          ? String(body.message)
          : 'Image upload failed.'
        reject(new Error(message))
        return
      }
      const parsed = ProductImageResponseSchema.safeParse(body)
      if (!parsed.success) reject(new Error('The image service returned an invalid response.'))
      else resolve(parsed.data)
    })
    request.addEventListener('error', () => reject(new Error('Image upload failed. Check your connection and retry.')))
    request.addEventListener('abort', () => reject(new Error('Image upload was cancelled.')))
    request.send(image)
  })
}

export async function removeProductImage(imageKey: string, sessionToken: string) {
  const response = await fetch(`/api/product-images?key=${encodeURIComponent(imageKey)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${sessionToken}` },
  })
  if (!response.ok) throw new Error('The uploaded image could not be removed.')
}

import { ProductImageResponseSchema, type ProductImageResponse } from '@nimtrace/contracts'

const SOURCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const MAX_SOURCE_BYTES = 10_000_000
const MAX_SOURCE_DIMENSION = 12_000
const MAX_SOURCE_PIXELS = 40_000_000
const OUTPUT_DIMENSION = 1600

export function validateProductImageFile(file: Pick<File, 'size' | 'type'>) {
  if (!SOURCE_TYPES.has(file.type)) {
    throw new Error('Choose a JPEG, PNG, WebP, or HEIC image. SVG, GIF, and other active formats are not accepted.')
  }
  if (file.size === 0 || file.size > MAX_SOURCE_BYTES) {
    throw new Error('Choose an image smaller than 10 MB.')
  }
}

export async function processProductImage(file: File): Promise<Blob> {
  validateProductImageFile(file)
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('This file could not be decoded as an image.')
  }

  try {
    if (
      bitmap.width < 64 || bitmap.height < 64
      || bitmap.width > MAX_SOURCE_DIMENSION || bitmap.height > MAX_SOURCE_DIMENSION
      || bitmap.width * bitmap.height > MAX_SOURCE_PIXELS
    ) {
      throw new Error('Choose an image between 64px and 12,000px with at most 40 megapixels.')
    }

    const scale = Math.min(1, OUTPUT_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('Image processing is unavailable on this device.')
    context.drawImage(bitmap, 0, 0, width, height)

    const output = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', 0.84)
    })
    if (!output || output.type !== 'image/webp') {
      throw new Error('This device could not create a safe WebP image.')
    }
    if (output.size > 1_500_000) {
      throw new Error('The processed image is still larger than 1.5 MB. Choose a simpler image.')
    }
    return output
  } finally {
    bitmap.close()
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
    request.setRequestHeader('Content-Type', 'image/webp')
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

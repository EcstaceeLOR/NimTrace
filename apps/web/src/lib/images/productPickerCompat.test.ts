import { afterEach, describe, expect, it } from 'vitest'
import { configureProductImagePickers, installProductImagePickerCompatibility } from './productPickerCompat'

describe('product image picker compatibility', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('keeps camera capture explicit and device upload gallery-capable', () => {
    document.body.innerHTML = `
      <input type="file" name="cameraImage" accept="image/png,image/jpeg,image/webp">
      <input type="file" name="uploadImage" accept="image/png,image/jpeg,image/webp" capture="environment">
    `

    configureProductImagePickers(document)

    const camera = document.querySelector<HTMLInputElement>('input[name="cameraImage"]')!
    const upload = document.querySelector<HTMLInputElement>('input[name="uploadImage"]')!

    expect(camera.accept).toBe('image/*')
    expect(camera.getAttribute('capture')).toBe('environment')
    expect(upload.accept).toBe('image/*')
    expect(upload.hasAttribute('capture')).toBe(false)
  })

  it('configures issuer inputs added after startup', async () => {
    const uninstall = installProductImagePickerCompatibility()

    const upload = document.createElement('input')
    upload.type = 'file'
    upload.name = 'uploadImage'
    upload.accept = 'image/jpeg'
    upload.setAttribute('capture', 'environment')
    document.body.append(upload)

    await new Promise<void>((resolve) => queueMicrotask(() => resolve()))

    expect(upload.accept).toBe('image/*')
    expect(upload.hasAttribute('capture')).toBe(false)
    uninstall()
  })
})

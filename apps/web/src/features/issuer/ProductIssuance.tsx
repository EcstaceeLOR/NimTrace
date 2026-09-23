import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  ProductIssuanceChallengeResponseSchema,
  PublishedProductResponseSchema,
  type ProductImageResponse,
  type ProductIssuanceChallengeResponse,
} from '@nimtrace/contracts'
import { formatNimFromLuna, nimToLuna } from '../../lib/formatting/nim'
import {
  processProductImage,
  removeProductImage,
  uploadProductImage,
} from '../../lib/images/productImage'
import { nimiqPayWallet } from '../../lib/nimiq/wallet'

interface ProductIssuanceProps {
  onClose(): void
  sessionToken: string
}

type IssuanceState =
  | { status: 'draft'; message?: string }
  | { status: 'preparing'; label: string; progress: number }
  | { status: 'review'; challenge: ProductIssuanceChallengeResponse }
  | { status: 'signing'; challenge: ProductIssuanceChallengeResponse }
  | { status: 'published'; id: string }
  | { status: 'failed'; message: string }

async function errorMessage(response: Response) {
  const value = await response.json().catch(() => null) as { message?: unknown } | null
  return typeof value?.message === 'string' ? value.message : 'The product could not be issued.'
}

export function ProductIssuance({ onClose, sessionToken }: ProductIssuanceProps) {
  const [state, setState] = useState<IssuanceState>({ status: 'draft' })
  const [previewUrl, setPreviewUrl] = useState<string>()
  const [uploadedImage, setUploadedImage] = useState<ProductImageResponse>()
  const [shareMessage, setShareMessage] = useState<string>()
  const [selectedImage, setSelectedImage] = useState<File>()
  const cameraInput = useRef<HTMLInputElement>(null)
  const uploadInput = useRef<HTMLInputElement>(null)
  const displayedImageUrl = uploadedImage?.url || previewUrl

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setSelectedImage(file || undefined)
    setPreviewUrl(file ? URL.createObjectURL(file) : undefined)
  }

  function removeSelection() {
    if (cameraInput.current) cameraInput.current.value = ''
    if (uploadInput.current) uploadInput.current.value = ''
    setSelectedImage(undefined)
    setPreviewUrl(undefined)
  }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setState({ status: 'preparing', label: 'Decoding and resizing image', progress: 5 })
    const form = new FormData(event.currentTarget)
    let storedImage: ProductImageResponse | undefined

    try {
      const image = selectedImage
      if (!(image instanceof File) || image.size === 0) throw new Error('Choose one product image.')
      const processedImage = await processProductImage(image)
      setState({ status: 'preparing', label: `Uploading safe ${processedImage.type === 'image/webp' ? 'WebP' : 'JPEG'} image`, progress: 25 })
      storedImage = await uploadProductImage(processedImage, sessionToken, (progress) => {
        setState({ status: 'preparing', label: `Uploading safe ${processedImage.type === 'image/webp' ? 'WebP' : 'JPEG'} image`, progress: 25 + Math.round(progress * 0.7) })
      })
      setUploadedImage(storedImage)
      const priceLuna = nimToLuna(String(form.get('priceNim') ?? ''))
      const response = await fetch('/api/products/issuance-challenges', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description: String(form.get('description') ?? ''),
          imageHash: storedImage.imageHash,
          imageKey: storedImage.imageKey,
          priceLuna,
          serialReference: String(form.get('serialReference') ?? ''),
          title: String(form.get('title') ?? ''),
          warrantyDurationDays: Number(form.get('warrantyDurationDays')),
          warrantySummary: String(form.get('warrantySummary') ?? ''),
        }),
      })
      if (!response.ok) throw new Error(await errorMessage(response))
      setState({
        status: 'review',
        challenge: ProductIssuanceChallengeResponseSchema.parse(await response.json()),
      })
    } catch (error) {
      if (storedImage && !storedImage.fallback) {
        await removeProductImage(storedImage.imageKey, sessionToken).catch(() => undefined)
        setUploadedImage(undefined)
      }
      setState({ status: 'failed', message: error instanceof Error ? error.message : 'Could not prepare product.' })
    }
  }

  async function editDraft() {
    try {
      if (uploadedImage && !uploadedImage.fallback) {
        await removeProductImage(uploadedImage.imageKey, sessionToken)
      }
      setUploadedImage(undefined)
      setState({ status: 'draft' })
    } catch (error) {
      setState({ status: 'failed', message: error instanceof Error ? error.message : 'Could not remove image.' })
    }
  }

  async function closeIssuer() {
    if (uploadedImage && !uploadedImage.fallback && state.status !== 'published') {
      await removeProductImage(uploadedImage.imageKey, sessionToken).catch(() => undefined)
    }
    onClose()
  }

  async function sharePublishedProduct(productId: string) {
    const url = `${window.location.origin}/products/${encodeURIComponent(productId)}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Buy a verified product on NimTrace', text: 'View this signed product passport and pay directly in NIM.', url })
        setShareMessage('Purchase link shared.')
        return
      }
      await navigator.clipboard.writeText(url)
      setShareMessage('Purchase link copied. Send it to the buyer to open in Nimiq Pay.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setShareMessage('Could not share automatically. Open the public product page and copy its URL.')
    }
  }

  async function publish(challenge: ProductIssuanceChallengeResponse) {
    setState({ status: 'signing', challenge })
    const signed = await nimiqPayWallet.sign(challenge.message)
    if (signed.status === 'cancelled') {
      setState({ status: 'review', challenge })
      return
    }
    if (signed.status === 'error') {
      setState({ status: 'failed', message: signed.error.message })
      return
    }

    try {
      const response = await fetch('/api/products', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          proof: {
            envelope: challenge.envelope,
            payload: challenge.payload,
            publicKey: signed.value.publicKey,
            signature: signed.value.signature,
          },
        }),
      })
      if (!response.ok) throw new Error(await errorMessage(response))
      const product = PublishedProductResponseSchema.parse(await response.json())
      setState({ status: 'published', id: product.id })
    } catch (error) {
      setState({ status: 'failed', message: error instanceof Error ? error.message : 'Publishing failed.' })
    }
  }

  return (
    <section className="issuer-panel" aria-labelledby="issuer-title">
      <div className="issuer-heading">
        <div><p className="eyebrow">MERCHANT STUDIO</p><h2 id="issuer-title">Issue a product</h2></div>
        <button className="issuer-close" type="button" onClick={() => void closeIssuer()} aria-label="Close product issuer">×</button>
      </div>

      {(state.status === 'draft' || state.status === 'preparing' || state.status === 'failed') && (
        <form className="issuer-form" onSubmit={(event) => void prepare(event)}>
          <p className="issuer-state issuer-wide">Draft</p>
          <label>Product title<input name="title" required maxLength={120} /></label>
          <label>Serial or merchant reference<input name="serialReference" required maxLength={120} /></label>
          <fieldset className="issuer-image-options issuer-wide">
            <legend>Product image</legend>
            <label className="button button--secondary issuer-image-option">
              Take a photo
              <input
                ref={cameraInput}
                name="cameraImage"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                capture="environment"
                onChange={selectImage}
              />
            </label>
            <label className="button button--secondary issuer-image-option">
              Upload from device
              <input
                ref={uploadInput}
                name="uploadImage"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={selectImage}
              />
            </label>
            <small className="issuer-help">JPEG, PNG, and WebP are supported across the target Nimiq Pay WebViews. HEIC/HEIF should be exported as JPEG first.</small>
          </fieldset>
          {previewUrl && (
            <div className="issuer-image-preview">
              <img src={previewUrl} alt="Selected product preview" />
              <button className="button button--secondary" type="button" onClick={removeSelection}>Remove image</button>
            </div>
          )}
          <label>Price in NIM<input name="priceNim" inputMode="decimal" placeholder="1.00" required /></label>
          <label>Warranty duration in days<input name="warrantyDurationDays" type="number" min="0" max="36500" required /></label>
          <label className="issuer-wide">Warranty summary<textarea name="warrantySummary" required maxLength={1000} /></label>
          <label className="issuer-wide">Description<textarea name="description" maxLength={4000} /></label>
          {state.status === 'failed' && <p className="issuer-error issuer-wide" role="alert">{state.message}</p>}
          {state.status === 'preparing' && (
            <div className="issuer-progress issuer-wide" role="status">
              <span>{state.label}</span>
              <progress max="100" value={state.progress}>{state.progress}%</progress>
            </div>
          )}
          <p className="issuer-help issuer-wide">Your wallet signature proves who issued this product. It is not legal verification by NimTrace or Nimiq.</p>
          <button className="button button--primary issuer-wide" disabled={state.status === 'preparing'}>
            {state.status === 'preparing' ? `${state.progress}% complete` : state.status === 'failed' ? 'Retry upload' : 'Review product'}
          </button>
        </form>
      )}

      {(state.status === 'review' || state.status === 'signing') && (
        <div className="issuer-review">
          <p className="issuer-state">Ready for wallet signature</p>
          <h3>{state.challenge.payload.title}</h3>
          {displayedImageUrl && (
            <div className="issuer-image-preview">
              <img src={displayedImageUrl} alt={`${state.challenge.payload.title} product preview`} />
            </div>
          )}
          <dl>
            <div><dt>Price</dt><dd>{formatNimFromLuna(state.challenge.payload.priceLuna)}</dd></div>
            <div><dt>Warranty</dt><dd>{state.challenge.payload.warrantyDurationDays} days</dd></div>
            <div><dt>Serial fingerprint</dt><dd>{state.challenge.payload.serialNumberHash.slice(0, 12)}…</dd></div>
          </dl>
          <p>{state.challenge.payload.warrantySummary}</p>
          {uploadedImage?.fallback && (
            <p className="issuer-fallback" role="status">Image storage is temporarily unavailable. The fixed NimTrace demo image will keep this product flow usable.</p>
          )}
          <p className="issuer-sign-summary">Nimiq Pay will show: “{state.challenge.envelope.summary}”</p>
          <button
            className="button button--primary"
            disabled={state.status === 'signing'}
            onClick={() => void publish(state.challenge)}
          >
            {state.status === 'signing' ? 'Waiting for signature…' : 'Sign and publish'}
          </button>
          <button className="button button--secondary" type="button" onClick={() => void editDraft()}>Edit draft</button>
        </div>
      )}

      {state.status === 'published' && (
        <div className="issuer-success" role="status">
          <p className="issuer-state">Published</p>
          <h3>Signed product issued.</h3>
          {displayedImageUrl && (
            <div className="issuer-image-preview">
              <img src={displayedImageUrl} alt="Published product" />
            </div>
          )}
          <p>Product ID: <code>{state.id}</code></p>
          <p className="issuer-help">This is the public listing ID. A wallet-owned Passport ID is created for the buyer after the NIM purchase is confirmed.</p>
          <a className="button button--primary" href={`/products/${encodeURIComponent(state.id)}`}>View public product</a>
          <button className="button button--secondary" type="button" onClick={() => void sharePublishedProduct(state.id)}>Share purchase link</button>
          {shareMessage && <p className="issuer-help" role="status">{shareMessage}</p>}
          <button className="button button--primary" type="button" onClick={onClose}>Done</button>
        </div>
      )}
    </section>
  )
}

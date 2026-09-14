import { Hono } from 'hono'
import {
  HealthResponseSchema,
  IdempotencyKeySchema,
  NimiqNetworkSchema,
  PaymentSubmissionRequestSchema,
  ProductImageResponseSchema,
  ProductDraftSchema,
  PurchaseIntentRequestSchema,
  PublishProductRequestSchema,
  WalletChallengeRequestSchema,
  WalletSessionRequestSchema,
} from '@nimtrace/contracts'
import { AuthServiceError, createWalletSession, issueWalletChallenge } from './auth/service'
import { SessionAuthenticationError, authenticatedWallet } from './auth/session'
import { ProductServiceError, createPublishedProduct, issueProductProof } from './products/service'
import { PublicProductError, getPublicProduct } from './products/public'
import {
  PaymentIntentServiceError,
  createInitialPurchaseIntent,
  recordPaymentSubmission,
} from './payments/service'
import {
  DEMO_IMAGE_KEY,
  ProductImageError,
  deleteProductImage,
  storeProductImage,
  validateProductImageReference,
} from './images/service'

interface Bindings {
  APP_VERSION?: string
  DB: D1Database
  ENVIRONMENT?: string
  NIMIQ_NETWORK?: string
  PRODUCT_IMAGES?: R2Bucket
}

export const app = new Hono<{ Bindings: Bindings }>()

app.get('/', (c) => c.json({ service: 'nimtrace-api', docs: '/api/health' }))

app.get('/api/health', (c) => {
  const health = HealthResponseSchema.parse({
    status: 'ok',
    service: 'nimtrace-api',
    version: c.env?.APP_VERSION ?? '0.1.0',
    environment: c.env?.ENVIRONMENT ?? 'unknown',
    timestamp: new Date().toISOString(),
  })

  return c.json(health, 200, {
    'Cache-Control': 'no-store',
  })
})

function networkFromEnvironment(value: string | undefined) {
  return NimiqNetworkSchema.parse(value ?? 'main-albatross')
}

app.post('/api/auth/challenges', async (c) => {
  const payload = WalletChallengeRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!payload.success) {
    return c.json({
      error: 'invalid_request' as const,
      message: 'A valid walletAddress is required.',
      recoverable: true,
    }, 400)
  }

  const challenge = await issueWalletChallenge(
    c.env.DB,
    payload.data.walletAddress,
    networkFromEnvironment(c.env.NIMIQ_NETWORK),
  )
  return c.json(challenge, 201, { 'Cache-Control': 'no-store' })
})

app.post('/api/auth/sessions', async (c) => {
  const payload = WalletSessionRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!payload.success) {
    return c.json({
      error: 'invalid_request' as const,
      message: 'The signed challenge response is malformed.',
      recoverable: true,
    }, 400)
  }

  const session = await createWalletSession(
    c.env.DB,
    payload.data,
    networkFromEnvironment(c.env.NIMIQ_NETWORK),
  )
  return c.json(session, 201, { 'Cache-Control': 'no-store' })
})

app.post('/api/products/issuance-challenges', async (c) => {
  const walletAddress = await authenticatedWallet(c.env.DB, c.req.header('Authorization'))
  const payload = ProductDraftSchema.safeParse(await c.req.json().catch(() => null))
  if (!payload.success) {
    return c.json({ error: 'invalid_product', message: 'Check the product details and try again.' }, 400)
  }

  await validateProductImageReference(
    c.env.PRODUCT_IMAGES,
    walletAddress,
    payload.data.imageKey,
    payload.data.imageHash,
  )

  const challenge = await issueProductProof(
    c.env.DB,
    walletAddress,
    payload.data,
    networkFromEnvironment(c.env.NIMIQ_NETWORK),
  )
  return c.json(challenge, 201, { 'Cache-Control': 'no-store' })
})

app.post('/api/products', async (c) => {
  const walletAddress = await authenticatedWallet(c.env.DB, c.req.header('Authorization'))
  const payload = PublishProductRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!payload.success) {
    return c.json({ error: 'invalid_product_proof', message: 'The signed product is malformed.' }, 400)
  }

  await validateProductImageReference(
    c.env.PRODUCT_IMAGES,
    walletAddress,
    payload.data.proof.payload.imageKey,
    payload.data.proof.payload.imageHash,
  )

  const product = await createPublishedProduct(
    c.env.DB,
    walletAddress,
    payload.data,
    networkFromEnvironment(c.env.NIMIQ_NETWORK),
  )
  return c.json(product, 201, { 'Cache-Control': 'no-store' })
})

app.post('/api/products/:productId/purchase-intents', async (c) => {
  const buyerAddress = await authenticatedWallet(c.env.DB, c.req.header('Authorization'))
  const idempotencyKey = IdempotencyKeySchema.safeParse(c.req.header('Idempotency-Key'))
  if (!idempotencyKey.success) {
    return c.json({
      error: 'invalid_idempotency_key',
      message: 'Idempotency-Key must be 16-128 URL-safe characters.',
      recoverable: true,
    }, 400)
  }

  const rawBody = await c.req.text()
  const payload = PurchaseIntentRequestSchema.safeParse(rawBody
    ? (() => { try { return JSON.parse(rawBody) as unknown } catch { return null } })()
    : {})
  if (!payload.success) {
    return c.json({
      error: 'invalid_purchase_intent',
      message: 'Purchase values are selected by the server and cannot be overridden.',
      recoverable: true,
    }, 400)
  }

  const result = await createInitialPurchaseIntent(
    c.env.DB,
    c.req.param('productId'),
    buyerAddress,
    idempotencyKey.data,
    networkFromEnvironment(c.env.NIMIQ_NETWORK),
  )
  return c.json(result.intent, result.created ? 201 : 200, { 'Cache-Control': 'no-store' })
})

app.post('/api/payment-intents/:intentId/submissions', async (c) => {
  const buyerAddress = await authenticatedWallet(c.env.DB, c.req.header('Authorization'))
  const payload = PaymentSubmissionRequestSchema.safeParse(await c.req.json().catch(() => null))
  if (!payload.success) {
    return c.json({
      error: 'invalid_transaction_hash',
      message: 'A valid Nimiq transaction hash is required.',
      recoverable: true,
    }, 400)
  }
  const submission = await recordPaymentSubmission(
    c.env.DB,
    c.req.param('intentId'),
    buyerAddress,
    payload.data.transactionHash,
  )
  return c.json(submission, 200, { 'Cache-Control': 'no-store' })
})

app.get('/api/products/:productId', async (c) => {
  const versionValue = c.req.query('version')
  const version = versionValue === undefined ? undefined : Number(versionValue)
  if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) {
    return c.json({ error: 'invalid_version', message: 'Product version must be a positive integer.' }, 400)
  }
  const product = await getPublicProduct(
    c.env.DB,
    c.req.param('productId'),
    networkFromEnvironment(c.env.NIMIQ_NETWORK),
    version,
  )
  return c.json(product, 200, { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=300' })
})

app.post('/api/product-images', async (c) => {
  const walletAddress = await authenticatedWallet(c.env.DB, c.req.header('Authorization'))
  const declaredLength = Number(c.req.header('Content-Length') ?? 0)
  if (declaredLength > 1_500_000) {
    throw new ProductImageError('image_too_large', 'Processed images must be smaller than 1.5 MB.', 413)
  }
  const image = await storeProductImage(
    c.env.PRODUCT_IMAGES,
    walletAddress,
    c.req.header('Content-Type'),
    await c.req.arrayBuffer(),
  )
  return c.json(ProductImageResponseSchema.parse(image), 201, { 'Cache-Control': 'no-store' })
})

app.delete('/api/product-images', async (c) => {
  const walletAddress = await authenticatedWallet(c.env.DB, c.req.header('Authorization'))
  const imageKey = c.req.query('key')
  if (!imageKey) {
    return c.json({ error: 'invalid_image_key', message: 'An image key is required.' }, 400)
  }
  const attachedProduct = await c.env.DB.prepare(`
    SELECT id FROM products WHERE image_key = ? LIMIT 1
  `).bind(imageKey).first<string>('id')
  if (attachedProduct) {
    return c.json({ error: 'image_in_use', message: 'A published product is using this image.' }, 409)
  }
  await deleteProductImage(c.env.PRODUCT_IMAGES, walletAddress, imageKey)
  return c.body(null, 204)
})

app.get('/api/product-images', async (c) => {
  const imageKey = c.req.query('key')
  if (!imageKey) return c.json({ error: 'invalid_image_key', message: 'An image key is required.' }, 400)
  if (imageKey === DEMO_IMAGE_KEY) return c.redirect('/demo-product.svg', 302)
  const object = await c.env.PRODUCT_IMAGES?.get(imageKey)
  if (!object) return c.json({ error: 'image_not_found', message: 'Image not found.' }, 404)

  const headers = new Headers({
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: object.httpEtag,
  })
  object.writeHttpMetadata(headers)
  return new Response(object.body, { headers })
})

app.notFound((c) => c.json({ error: 'not_found', message: 'Route not found' }, 404))

app.onError((error, c) => {
  if (error instanceof PaymentIntentServiceError) {
    return c.json({ error: error.code, message: error.message, recoverable: true }, error.status)
  }
  if (error instanceof PublicProductError) {
    return c.json({ error: 'product_not_found', message: error.message }, 404)
  }
  if (error instanceof ProductImageError) {
    return c.json({ error: error.code, message: error.message, recoverable: true }, error.status)
  }
  if (error instanceof SessionAuthenticationError) {
    return c.json({ error: 'unauthorized', message: error.message, recoverable: true }, 401)
  }
  if (error instanceof ProductServiceError) {
    return c.json({ error: error.code, message: error.message, recoverable: true }, error.status)
  }
  if (error instanceof AuthServiceError) {
    return c.json({
      error: error.code,
      message: error.message,
      recoverable: error.recoverable,
    }, error.status)
  }

  console.error('Unhandled API error', error)
  return c.json({
    error: 'internal_error' as const,
    message: 'The request could not be completed',
    recoverable: true,
  }, 500)
})

export default app

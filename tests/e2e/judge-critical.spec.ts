import { expect, test } from '@playwright/test'

const productId = 'product-id-with-enough-entropy'
const passportId = 'passport-id-with-entropy'
const hash = (character: string) => character.repeat(64)

const product = {
  currentVersion: 1,
  description: 'Repairable wireless headphones.',
  id: productId,
  imageUrl: '/api/product-images?key=missing-e2e-image',
  issuedAt: '2026-09-14T12:00:00.000Z',
  issuerAddress: 'NQ12 TEST 0000 0000 0000 0000 0000 0000 0000',
  priceLuna: 100000,
  proofHash: hash('a'),
  serialFingerprint: 'b'.repeat(12),
  signatureState: 'verified',
  state: 'available',
  title: 'NimTrace Headphones',
  version: 1,
  warrantyDurationDays: 730,
  warrantySummary: 'Manufacturing defects are covered for two years.',
}

const passport = {
  checkedAt: '2026-09-15T10:00:00.000Z',
  eventChain: {
    eventCount: 1,
    events: [{
      createdAt: '2026-09-14T12:00:00.000Z',
      eventHash: hash('c'),
      maskedActor: 'NQ12TE••••••000000',
      previousEventHash: null,
      sequence: 1,
      type: 'issued',
    }],
    headEventHash: hash('c'),
    state: 'verified',
  },
  id: passportId,
  merchantClaims: {
    description: 'Merchant says this headset uses repairable parts.',
    warrantySummary: 'Merchant says defects are covered for one year.',
  },
  overallState: 'verified',
  ownership: { maskedCurrentOwner: 'NQ34BU••••••111111', state: 'verified' },
  product: {
    imageUrl: '/demo-product.svg',
    issuerAddress: product.issuerAddress,
    payloadHash: hash('d'),
    state: 'verified',
    title: product.title,
    version: 1,
  },
  publicUrl: `http://127.0.0.1:5173/passports/${passportId}`,
  purchase: {
    blockHeight: 123456,
    confirmedAt: '2026-09-14T12:00:00.000Z',
    reason: 'verified_final',
    state: 'verified',
    transactionHash: hash('e'),
  },
  status: 'active',
  warranty: {
    daysRemaining: 364,
    expiresAt: '2027-09-14T12:00:00.000Z',
    startedAt: '2026-09-14T12:00:00.000Z',
    state: 'active',
  },
}

test('public product remains usable when its image cannot load', async ({ page }) => {
  await page.route(`**/api/products/${productId}`, (route) => route.fulfill({ json: product }))
  await page.route('**/api/product-images?key=missing-e2e-image', (route) => route.fulfill({ status: 404, json: { error: 'image_not_found' } }))

  await page.goto(`/products/${productId}`)

  await expect(page.getByRole('heading', { name: product.title })).toBeVisible()
  await expect(page.getByText('Product image unavailable')).toBeVisible()
  await expect(page.getByText('1 NIM')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Buy with NIM' })).toBeVisible()
})

test('public passport verification renders cryptographic evidence without a wallet', async ({ page }) => {
  await page.route(`**/api/passports/${passportId}/verification`, (route) => route.fulfill({ json: passport }))

  await page.goto(`/passports/${passportId}`)

  await expect(page.getByRole('heading', { name: product.title })).toBeVisible()
  await expect(page.getByText('Verified passport')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Cryptographic facts' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Merchant claims' })).toBeVisible()
})

test('verify route resolves a passport ID into its signed public proof', async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ json: {
    status: 'ok', service: 'nimtrace-api', network: 'main-albatross', version: '0.1.0', environment: 'e2e', timestamp: new Date().toISOString(),
  } }))
  await page.route(`**/api/passports/${passportId}/verification`, (route) => route.fulfill({ json: passport }))

  await page.goto('/verify')
  await page.getByLabel('Product or Passport ID').fill(passportId)
  await page.getByRole('button', { name: 'Open signed proof' }).click()

  await expect(page).toHaveURL(new RegExp(`/passports/${passportId}$`))
  await expect(page.getByRole('heading', { name: product.title })).toBeVisible()
})

test('issuer entry route restores an authenticated merchant session', async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('nimtrace.walletSession', JSON.stringify({
      walletAddress: 'NQ12 TEST 0000 0000 0000 0000 0000 0000 0000',
      sessionToken: 'e2e-session-token-that-is-long-enough-for-the-client',
      expiresAt: '2099-01-01T00:00:00.000Z',
    }))
  })
  await page.route('**/api/health', (route) => route.fulfill({ json: {
    status: 'ok', service: 'nimtrace-api', network: 'main-albatross', version: '0.1.0', environment: 'e2e', timestamp: new Date().toISOString(),
  } }))

  await page.goto('/issue')

  await expect(page.getByRole('heading', { name: 'Issue a product' })).toBeVisible()
  await expect(page.getByLabel('Product title')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review product' })).toBeVisible()
})

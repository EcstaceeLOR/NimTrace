import { expect, test } from '@playwright/test'

test('loads the NimTrace foundation and reaches the Worker API', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: /every product deserves proof that lasts/i })).toBeVisible()
  await expect(page.getByText('Mainnet ready')).toBeVisible()
})

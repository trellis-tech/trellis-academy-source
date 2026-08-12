import { test, expect } from '../../../core/fixtures'
import { API_URL, BASE_URL } from '../../../core/instance'
import { ACADEMY_SESSION_STATE, readAcademyLearningRows } from '../../../core/academyFixture'
import {
  TRELLIS_STATE,
  deactivateTrellisUser,
  readTrellisFixture,
} from '../../../core/trellisFixture'

test.describe.configure({ mode: 'serial' })

for (const unsafe of ['https://example.com/escape', '//example.com/escape', '/billing']) {
  test(`unsafe learner destination is reduced to the Academy catalog: ${unsafe}`, async ({ page }) => {
    await page.goto(`${BASE_URL}/login?next=${encodeURIComponent(unsafe)}`)
    await expect(page.locator('input[name="destination"]')).toHaveValue('/courses')
  })
}

for (const path of ['/auth/signup', '/auth/forgot', '/auth/reset', '/auth/magic', '/admin/login']) {
  test(`native Academy auth surface is absent: ${path}`, async ({ request }) => {
    const response = await request.get(`${BASE_URL}${path}`, { maxRedirects: 0 })
    expect([404, 410]).toContain(response.status())
  })
}

for (const path of [
  '/ai',
  '/billing',
  '/embed/default/course/example/activity/example',
  '/playgrounds',
  '/api/billing/prices',
  '/api/v1/ai',
  '/api/v1/orgs/1/ai-credits',
  '/api/v1/orgs/1/packs',
  '/api/v1/plans',
  '/api/v1/playgrounds',
]) {
  test(`excluded AI or billing surface is absent: ${path}`, async ({ request }) => {
    const origin = path.startsWith('/api/v1/') ? API_URL.replace(/\/api\/v1$/, '') : BASE_URL
    const response = await request.get(`${origin}${path}`, { maxRedirects: 0 })
    expect([404, 410]).toContain(response.status())
  })
}

test.describe('deactivated Trellis user', () => {
  test('old Academy refresh is denied without deleting learning rows, and no new session is issued', async ({
    browser,
  }) => {
    const fixture = readTrellisFixture()
    const before = readAcademyLearningRows(fixture.userId)
    expect(before.runs).toBeGreaterThan(0)
    expect(before.steps).toBeGreaterThan(0)

    const oldAcademy = await browser.newContext({ storageState: ACADEMY_SESSION_STATE })
    await deactivateTrellisUser(fixture.userId)
    const oldRefresh = await oldAcademy.request.post(`${API_URL}/auth/trellis/refresh`)
    expect(oldRefresh.status()).toBe(401)
    await oldAcademy.close()

    expect(readAcademyLearningRows(fixture.userId)).toEqual(before)

    const newSession = await browser.newContext({ storageState: TRELLIS_STATE })
    const page = await newSession.newPage()
    await page.goto(`${BASE_URL}/login`)
    const exchange = page.waitForResponse((response) =>
      response.url().includes('/api/auth/trellis/callback')
    )
    await page.getByRole('button', { name: 'Continue with Trellis' }).click()
    expect((await exchange).status()).toBe(401)
    await newSession.close()
  })
})

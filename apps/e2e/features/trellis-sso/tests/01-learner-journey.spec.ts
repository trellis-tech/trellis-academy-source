import { test, expect } from '../../../core/fixtures'
import { API_URL, BASE_URL } from '../../../core/instance'
import { ACADEMY_SESSION_STATE, readAcademyFixture } from '../../../core/academyFixture'
import { TRELLIS_STATE } from '../../../core/trellisFixture'
import { AssignmentPage } from '../../assignments/pages/student'

test.use({ storageState: TRELLIS_STATE })
test.describe.configure({ mode: 'serial' })

test('Trellis user exchanges a single-use assertion, keeps the course deep link, and starts it', async ({
  page,
  request,
}) => {
  const fixture = readAcademyFixture()
  let assertion = ''
  page.on('request', (observed) => {
    const url = new URL(observed.url())
    if (url.pathname === '/api/auth/trellis/callback') {
      assertion = url.searchParams.get('assertion') ?? assertion
    }
  })

  await page.goto(`${BASE_URL}/login?next=${encodeURIComponent(fixture.destination)}`)
  const continueButton = page.getByRole('button', { name: 'Continue with Trellis' })
  await expect(continueButton).toBeVisible()
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await continueButton.click()

  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(fixture.destination)}(?:[?#]|$)`))
  expect(assertion).not.toBe('')
  await expect
    .poll(async () => (await page.context().cookies(BASE_URL)).map((cookie) => cookie.name))
    .toEqual(expect.arrayContaining(['LH_access', 'LH_refresh', 'LH_session']))
  await expect.poll(() => page.evaluate(() => document.cookie)).toContain('LH_session=1')

  await page.goto(`${BASE_URL}/owner`)
  await expect(page.getByRole('heading', { name: 'Publishing workspace' })).toBeVisible()
  await expect(page.getByText('Repository source', { exact: true })).toBeVisible()
  await expect(page.getByText('Draft only', { exact: true })).toBeVisible()
  await page.goto(`${BASE_URL}${fixture.destination}`)

  const startCourse = page.waitForResponse(
    (response) =>
      response.url().includes(`/trail/add_course/course_${fixture.courseUuid}`) &&
      response.request().method() === 'POST'
  )
  await page.getByRole('button', { name: /start course/i }).click()
  expect((await startCourse).ok()).toBe(true)
  await expect(page).toHaveURL(
    new RegExp(
      `/course/${escapeRegExp(fixture.courseUuid)}/activity/${escapeRegExp(fixture.activityUuid)}`
    )
  )
  await expect(page.getByText('Assignment', { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  })

  const assignment = new AssignmentPage(page)
  await assignment.answerQuiz('A')
  await assignment.saveProgress()
  await page.reload()
  await expect(page.getByText('Assignment', { exact: true }).first()).toBeVisible()
  await assignment.submitForGrading()
  await assignment.expectGraded(100)

  const accessToken = await academyAccessToken(page)
  const trail = await fetch(`${API_URL}/trail/org/${fixture.orgId}/trail`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  expect(trail.ok).toBe(true)
  const payload: unknown = await trail.json()
  expect(JSON.stringify(payload)).toContain(`course_${fixture.courseUuid}`)
  expect(JSON.stringify(payload)).toContain(`"activity_id":${fixture.activityId}`)
  await page.context().storageState({ path: ACADEMY_SESSION_STATE })

  const replay = await request.post(`${API_URL}/auth/trellis/exchange`, {
    data: { assertion },
  })
  expect(replay.status()).toBe(410)
})

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function academyAccessToken(page: import('@playwright/test').Page): Promise<string> {
  const cookie = (await page.context().cookies(BASE_URL)).find(
    (entry) => entry.name === 'LH_access'
  )
  if (!cookie) throw new Error('Academy session did not set LH_access')
  return cookie.value
}

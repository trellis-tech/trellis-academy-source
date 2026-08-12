/**
 * Playwright global setup.
 *
 * The repository wrapper owns process boot and teardown. This setup waits for
 * both first-party applications and creates one synthetic local Trellis user.
 */
import { API_URL, ORG_SLUG, TRELLIS_URL } from './core/instance'
import { seedTrellisFixture } from './core/trellisFixture'
import { seedAcademyFixture } from './core/academyFixture'
import { requireProductEndpoint } from './core/productContract'

const BOOT_TIMEOUT_MS = 8 * 60 * 1000 // image pull + first-run install can be slow
const POLL_INTERVAL_MS = 3000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForOk(url: string, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastErr = ''
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        console.log(`✓ ${label} ready (${url})`)
        return
      }
      lastErr = `status ${res.status}`
    } catch (error) {
      lastErr = error instanceof Error ? error.message : String(error)
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`Timed out waiting for ${label} at ${url}: ${lastErr}`)
}

export default async function globalSetup(): Promise<void> {
  await waitForOk(`${API_URL}/health`, BOOT_TIMEOUT_MS, 'Academy API health')
  await waitForOk(`${TRELLIS_URL}/login`, BOOT_TIMEOUT_MS, 'Trellis app')
  await requireProductEndpoint(fetch, `${API_URL}/auth/trellis/exchange`, 'Academy SSO exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assertion: '' }),
  })
  await requireProductEndpoint(
    fetch,
    `${TRELLIS_URL}/api/academy/sso/start?state=invalid`,
    'Trellis SSO start'
  )
  const academy = await seedAcademyFixture()
  const fixture = seedTrellisFixture()
  console.log(
    `Local Academy and Trellis are ready. Synthetic Trellis subject: ${fixture.userId}; learner destination: ${academy.destination}`
  )
}

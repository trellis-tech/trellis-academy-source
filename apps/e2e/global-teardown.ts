/**
 * Playwright global teardown.
 *
 * Cleans the synthetic Trellis user/workspace. The repository wrapper owns
 * local service and container teardown.
 */
import { cleanupTrellisFixture } from './core/trellisFixture'

export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_KEEP === '1') {
    console.log('E2E_KEEP=1 — preserving the synthetic Trellis fixture for debugging.')
    return
  }
  cleanupTrellisFixture()
}

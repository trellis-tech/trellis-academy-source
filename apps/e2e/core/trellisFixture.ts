import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const TRELLIS_AUTH_DIR = join(REPOSITORY_ROOT, 'test/e2e/.auth')
const TRELLIS_SETUP = join(REPOSITORY_ROOT, 'test/e2e/global-setup.ts')
const TRELLIS_TEARDOWN = join(REPOSITORY_ROOT, 'test/e2e/global-teardown.ts')

export const TRELLIS_STATE = join(TRELLIS_AUTH_DIR, 'app-api-user.json')
export const TRELLIS_CONTEXT = join(TRELLIS_AUTH_DIR, 'app-api-context.json')

export interface TrellisFixtureContext {
  email: string
  userId: string
  workspaceId: string
  workspaceSlug: string
}

function runFixtureModule(modulePath: string, operation: string): void {
  const moduleUrl = pathToFileURL(modulePath).href
  const script = `import operation from ${JSON.stringify(moduleUrl)}; await operation(undefined)`
  const result = spawnSync('bun', ['--eval', script], {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, TRELLIS_APP_API_SETUP: '1' },
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`Trellis E2E fixture ${operation} failed with exit ${result.status}`)
  }
}

export function seedTrellisFixture(): TrellisFixtureContext {
  runFixtureModule(TRELLIS_SETUP, 'setup')
  return readTrellisFixture()
}

export function readTrellisFixture(): TrellisFixtureContext {
  if (!existsSync(TRELLIS_STATE) || !existsSync(TRELLIS_CONTEXT)) {
    throw new Error('Trellis E2E fixture did not create its storage state and context')
  }
  const parsed: unknown = JSON.parse(readFileSync(TRELLIS_CONTEXT, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Trellis E2E fixture context is not an object')
  }
  const email = Reflect.get(parsed, 'email')
  const userId = Reflect.get(parsed, 'userId')
  const workspaceId = Reflect.get(parsed, 'workspaceId')
  const workspaceSlug = Reflect.get(parsed, 'workspaceSlug')
  if (
    typeof email !== 'string' ||
    typeof userId !== 'string' ||
    typeof workspaceId !== 'string' ||
    typeof workspaceSlug !== 'string'
  ) {
    throw new Error('Trellis E2E fixture context is missing required identity fields')
  }
  return { email, userId, workspaceId, workspaceSlug }
}

export function cleanupTrellisFixture(): void {
  if (!existsSync(TRELLIS_CONTEXT)) return
  runFixtureModule(TRELLIS_TEARDOWN, 'teardown')
}

export async function deactivateTrellisUser(userId: string): Promise<void> {
  const supabaseUrl = process.env.E2E_SUPABASE_URL
  const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Local Supabase admin environment is required to deactivate the fixture user')
  }
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ ban_duration: '876000h' }),
  })
  if (!response.ok) {
    throw new Error(`Could not deactivate local Trellis fixture user: ${response.status}`)
  }
}

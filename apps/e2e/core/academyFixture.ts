import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ACADEMY_FIXTURE_PATH = fileURLToPath(
  new URL('../.auth/trellis-academy-course.json', import.meta.url)
)
export const ACADEMY_SESSION_STATE = fileURLToPath(
  new URL('../.auth/trellis-academy-session.json', import.meta.url)
)
export const ACADEMY_PUBLISHER_RECEIPT_PATH = fileURLToPath(
  new URL('../.auth/trellis-academy-publisher-receipt.json', import.meta.url)
)

export interface AcademyFixtureContext {
  orgId: number
  assignmentUuid: string
  courseUuid: string
  activityId: number
  activityUuid: string
  destination: string
}

interface RepositoryPublication {
  receipt: Record<string, unknown>
  nativeIds: {
    courses: Record<string, string>
    modules: Record<string, string>
    lessons: Record<string, string>
    assessments: Record<string, string>
  }
}

export async function seedAcademyFixture(): Promise<AcademyFixtureContext> {
  const published = publishRepositoryFixture()
  const native = readPublishedNativeProjection(published.nativeIds)
  const fullCourseUuid = published.nativeIds.courses['platform-readiness']
  const fullActivityUuid = published.nativeIds.lessons['platform-readiness-check']
  const fixture = {
    orgId: native.orgId,
    assignmentUuid: published.nativeIds.assessments['platform-readiness-quiz'],
    courseUuid: fullCourseUuid.replace(/^course_/, ''),
    activityId: native.activityId,
    activityUuid: fullActivityUuid.replace(/^activity_/, ''),
    destination: `/course/${fullCourseUuid.replace(/^course_/, '')}`,
  }
  mkdirSync(dirname(ACADEMY_FIXTURE_PATH), { recursive: true })
  writeFileSync(ACADEMY_FIXTURE_PATH, JSON.stringify(fixture, null, 2), { mode: 0o600 })
  writeFileSync(
    ACADEMY_PUBLISHER_RECEIPT_PATH,
    JSON.stringify(published.receipt, null, 2),
    { mode: 0o600 }
  )
  return fixture
}

function publishRepositoryFixture(): RepositoryPublication {
  const script = fileURLToPath(new URL('../fixtures/publish-academy-fixture.mjs', import.meta.url))
  const result = spawnSync('node', [script], { encoding: 'utf8', env: process.env })
  if (result.status !== 0) {
    throw new Error(`Academy repository publication failed: ${result.stderr}`)
  }
  const value: unknown = JSON.parse(result.stdout)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Academy repository publication receipt is invalid')
  }
  const receipt = Reflect.get(value, 'receipt')
  const nativeIds = Reflect.get(value, 'nativeIds')
  if (
    !receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
    !nativeIds || typeof nativeIds !== 'object' || Array.isArray(nativeIds)
  ) {
    throw new Error('Academy repository publication receipt is incomplete')
  }
  return {
    receipt,
    nativeIds: {
      courses: stringRecord(Reflect.get(nativeIds, 'courses'), 'courses'),
      modules: stringRecord(Reflect.get(nativeIds, 'modules'), 'modules'),
      lessons: stringRecord(Reflect.get(nativeIds, 'lessons'), 'lessons'),
      assessments: stringRecord(Reflect.get(nativeIds, 'assessments'), 'assessments'),
    },
  }
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Academy repository publication has invalid ${label} IDs`)
  }
  const entries = Object.entries(value)
  if (!entries.every((entry) => typeof entry[1] === 'string')) {
    throw new Error(`Academy repository publication has invalid ${label} IDs`)
  }
  return Object.fromEntries(entries)
}

function readPublishedNativeProjection(nativeIds: RepositoryPublication['nativeIds']): {
  orgId: number
  activityId: number
} {
  const courseUuid = nativeIds.courses['platform-readiness']
  const activityUuid = nativeIds.lessons['platform-readiness-check']
  if (!/^course_[0-9a-f]{24}$/.test(courseUuid) || !/^activity_[0-9a-f]{24}$/.test(activityUuid)) {
    throw new Error('Academy repository publication returned invalid native IDs')
  }
  const result = spawnSync(
    'docker',
    [
      'exec',
      'learnhouse-db-dev',
      'psql',
      '-U',
      'learnhouse',
      '-d',
      'learnhouse',
      '-Atc',
      `SELECT json_build_object('orgId', c.org_id, 'activityId', a.id) FROM course c JOIN activity a ON a.course_id = c.id WHERE c.course_uuid = '${courseUuid}' AND a.activity_uuid = '${activityUuid}' AND c.public = TRUE AND c.published = TRUE AND a.published = TRUE`,
    ],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) {
    throw new Error(`Academy native publication readback failed: ${result.stderr}`)
  }
  const value: unknown = JSON.parse(result.stdout.trim())
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Academy native publication readback is invalid')
  }
  const orgId = Reflect.get(value, 'orgId')
  const activityId = Reflect.get(value, 'activityId')
  if (!Number.isInteger(orgId) || !Number.isInteger(activityId)) {
    throw new Error('Academy native publication readback is incomplete')
  }
  return { orgId, activityId }
}

export function readAcademyFixture(): AcademyFixtureContext {
  if (!existsSync(ACADEMY_FIXTURE_PATH)) {
    throw new Error('Academy E2E fixture was not created by global setup')
  }
  const value: unknown = JSON.parse(readFileSync(ACADEMY_FIXTURE_PATH, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Academy E2E fixture is invalid')
  }
  const assignmentUuid = Reflect.get(value, 'assignmentUuid')
  const orgId = Reflect.get(value, 'orgId')
  const courseUuid = Reflect.get(value, 'courseUuid')
  const activityId = Reflect.get(value, 'activityId')
  const activityUuid = Reflect.get(value, 'activityUuid')
  const destination = Reflect.get(value, 'destination')
  if (
    typeof orgId !== 'number' || typeof assignmentUuid !== 'string' ||
    typeof courseUuid !== 'string' || typeof activityId !== 'number' ||
    typeof activityUuid !== 'string' || typeof destination !== 'string'
  ) {
    throw new Error('Academy E2E fixture is missing required fields')
  }
  return { orgId, assignmentUuid, courseUuid, activityId, activityUuid, destination }
}

export function readAcademyLearningRows(subject: string): { runs: number; steps: number } {
  const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
  const apiDirectory = join(repositoryRoot, 'trellis-academy/apps/api')
  const script = fileURLToPath(new URL('../fixtures/read-learning-rows.py', import.meta.url))
  const result = spawnSync('uv', ['run', '--frozen', 'python', script, subject], {
    cwd: apiDirectory,
    env: { ...process.env, PYTHONPATH: apiDirectory },
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`Academy learning row receipt failed: ${result.stderr}`)
  }
  const value: unknown = JSON.parse(result.stdout)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Academy learning row receipt is invalid')
  }
  const runs = Reflect.get(value, 'runs')
  const steps = Reflect.get(value, 'steps')
  if (typeof runs !== 'number' || typeof steps !== 'number') {
    throw new Error('Academy learning row receipt is missing counts')
  }
  return { runs, steps }
}

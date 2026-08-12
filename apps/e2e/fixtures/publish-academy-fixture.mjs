import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import {
  compileAcademyManifest,
  loadAcademyManifest,
  publishCompiledRelease,
  rollbackPublishedRelease,
} from '../../../../scripts/academy-publisher.mjs'

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const manifestPath = fileURLToPath(new URL('../../../content/academy.yaml', import.meta.url))
const apiUrl = process.env.E2E_API_URL
const publisherSecret = process.env.E2E_ACADEMY_PUBLISHER_SECRET
if (!apiUrl || !publisherSecret) {
  throw new Error('Academy E2E publisher configuration is unavailable')
}

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim()
const compiled = compileAcademyManifest(await loadAcademyManifest(manifestPath), {
  sourceCommit,
  requiredLocales: ['en'],
})
const releasePrefix = `academy-release/e2e-${compiled.digest.slice(0, 12)}`
const initialReceipt = await publishCompiledRelease({
  apiUrl,
  publisherSecret,
  compiled,
  operatorInstruction: 'publish synthetic platform readiness fixture',
  releaseTag: `${releasePrefix}-initial`,
  environment: 'e2e',
  rollbackTarget: 'academy-release/empty',
})
const rollbackReceipt = await rollbackPublishedRelease({
  apiUrl,
  publisherSecret,
  targetReleaseTag: 'academy-release/empty',
  releaseTag: `${releasePrefix}-rollback`,
  operatorInstruction: 'rollback synthetic platform readiness fixture',
  environment: 'e2e',
  expectedDigest: createHash('sha256').update('{}').digest('hex'),
})
const recoveryReceipt = await publishCompiledRelease({
  apiUrl,
  publisherSecret,
  compiled,
  operatorInstruction: 'restore synthetic platform readiness fixture',
  releaseTag: `${releasePrefix}-recovered`,
  environment: 'e2e',
  rollbackTarget: `${releasePrefix}-rollback`,
})

process.stdout.write(JSON.stringify({
  receipt: {
    initial: initialReceipt,
    rollback: rollbackReceipt,
    recovery: recoveryReceipt,
  },
  nativeIds: compiled.nativeIds,
}))

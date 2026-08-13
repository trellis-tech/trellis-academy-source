# Academy production operations

This runbook covers the pre-curriculum Academy release. Procedures are not
proof: each release retains exact-revision receipts for deployment, source,
backup/restore, rollback, and authenticated product replay.

## Entry points and ownership

- Learner and owner entry: `https://academy.trellistech.com/login`
- Owner workspace after SSO: `https://academy.trellistech.com/owner`
- Learner catalog: `https://academy.trellistech.com/courses`
- Identity authority: `https://app.trellistech.com`
- Web deployment: Vercel project `trellis-academy`
- API deployment: Fly app `trellis-academy-api`
- Durable data and media: dedicated Supabase project `Trellis Academy`
- Exchange/replay state: managed Redis

Private preview is intentionally limited to `michel@trellistech.com`. The same
address must be present in both the Trellis issuer allowlist and the Academy API
allowlist, and must be in the Academy owner allowlist. Adding a user is an
explicit access-policy change, not an Academy invitation.

## GitHub release environment

The `academy-production` environment is restricted to protected branches. It
uses repository-level `FLY_API_TOKEN` and `VERCEL_TOKEN`, plus these Academy
values:

| Kind | Name | Purpose |
| --- | --- | --- |
| Variable | `VERCEL_ORG_ID` | Vercel team ID |
| Variable | `VERCEL_ACADEMY_PROJECT_ID` | Academy web project ID |
| Variable | `ACADEMY_BACKUP_RESTORE_VERIFIED_AT` | Timestamp of the latest successful isolated restore rehearsal |
| Variable | `ACADEMY_PUBLIC_SOURCE_URL` | Public corresponding-source tag/archive readback URL |
| Secret | `ACADEMY_MIGRATION_DATABASE_URL` | Direct or session-safe migration connection for the dedicated Academy DB |
| Secret | `ACADEMY_S3_ACCESS_KEY_ID` | Supabase Storage S3 access key |
| Secret | `ACADEMY_S3_SECRET_ACCESS_KEY` | Supabase Storage S3 secret |
| Secret | `ACADEMY_S3_ENDPOINT_URL` | Dedicated project S3 endpoint |
| Secret | `ACADEMY_S3_BUCKET_NAME` | Private Academy media bucket |
| Secret | `ACADEMY_PUBLISHER_SECRET` | Server-only repository publisher authority |

Missing values fail before migrations or deployment. Do not substitute the
Trellis application database, a public bucket, filesystem storage, or a generic
organization-wide credential.

## Release order

`.github/workflows/deploy-academy.yml` is the only normal production path:

1. Check platform, source, content, and provenance contracts.
2. Build a fresh local stack and pass lint, unit/integration tests, production
   build, real SSO E2E, denial matrix, persistence readback, and zero-write guard.
3. Verify recovery prerequisites and public corresponding source.
4. Apply Academy migrations and record the exact Alembic head.
5. Build immutable Fly and Vercel candidates without changing production.
6. Apply the backward-compatible migration and stage durable Supabase S3 credentials.
7. Capture the predecessor Fly image, live Fly configuration, and Vercel deployment.
8. Promote API and web in one compensated cutover. A failed API, web, public,
   or publication check restores the predecessor publication, Vercel deployment,
   Fly image, and Fly configuration.
9. Verify the public containing deployment and retain the release artifact.
10. Run the Michel-only authenticated production replay and attach its redacted
   receipt to the release or ticket.

Health proves routing and process availability only. Do not declare release
success without the authenticated replay.

## Verified pre-curriculum release baseline

Release `9717e17b862375d17419af7b5ab9efe65c3d7d44` completed the production
workflow on 2026-08-13. Its retained release artifact records migration head
`u4v5w6x7y8z9`, the immutable Fly image, SHA-bound Vercel deployment, public
corresponding-source URL, publication tag and digest, predecessor rollback
target, and restore-verification timestamp.

The authenticated replay proved `michel@trellistech.com` as Academy owner,
owner workspace access, explicit logout, returning Trellis SSO, synthetic
course start, saved quiz answer, server-verified 100/100 grading, and durable
100% progress after refresh. Real curriculum was not created.

## Backup and isolated restore rehearsal

Before the first content-bearing production release, and after material schema
or storage changes:

1. Record the provider backup mode and latest completed backup without copying
   credentials. PITR is optional; do not claim it when the provider reports it disabled.
2. Create a database backup from the dedicated Academy project.
3. Restore it into a new isolated non-production project or database. Never
   restore over production.
4. Apply no destructive downgrade. Bring the restored target to the recorded
   migration head if required by expand/migrate/contract compatibility.
5. Restore the Academy-owned `public` schema; Supabase manages platform schemas
   such as Auth, Storage, Realtime, and Vault independently. Read back only the
   fixed organization, synthetic publication receipt,
   learner progress, submission, grade, certificate, and referenced media
   object checksums.
6. Record source project, backup identity, isolated target, migration head,
   row/object checks, start/end timestamps, and operator. Redact credentials and
   learner data.
7. Destroy the isolated target after the receipt is retained.

The production workflow's restore-verification timestamp is updated only after this rehearsal
succeeds. A dashboard badge or successful backup creation is not restore proof.

The first production rehearsal receipt is retained at
`trellis/evidence/2026-08-12-database-restore.json`.

## Immutable rollback

Application rollback uses the predecessor identifiers in the last successful
`academy-production-release` artifact:

Dispatch `.github/workflows/rollback-academy.yml` with that receipt's exact
revision, migration head, Fly registry image reference, Vercel deployment URL, publication
release tag, and publication digest. The workflow rejects mutable or malformed
identifiers, loads `fly.toml` from the recorded predecessor revision, and retains
a rollback receipt. If any surface fails after another has already restored,
use GitHub's **Re-run jobs** action on that same workflow run. The rollback
publication tag is bound to `github.run_id`, so a rerun idempotently converges
the API, web, and publication instead of creating a second rollback receipt.
Do not dispatch a new rollback run with changed inputs to recover a partial run.

1. Stop promotion of the candidate web deployment.
2. Promote the recorded predecessor Vercel deployment.
3. Redeploy the recorded predecessor Fly registry image reference to
   `trellis-academy-api`.
4. Do not run destructive schema downgrade SQL. The predecessor must remain
   compatible with the expanded schema.
5. Read back the predecessor revision and migration compatibility from both
   API and web health endpoints.
6. Replay Michel's login, catalog, progress, and synthetic assessment read.
7. Record the rollback receipt and diagnose the candidate offline.

Publication rollback is independent and follows `PUBLISHING.md`.

## Troubleshooting boundaries

- `404` from `/api/v1/release`: API is an older, non-containing deployment.
- Healthy public web plus failed login: verify Trellis issuer/allowlist, SSO
  shared secret parity, Redis, and Academy subject state; DNS is not proof.
- Login loops: compare public origin, cookie domain, callback allowlist, and
  return-path normalization. Never enable native auth as a workaround.
- Media fails after deploy: verify S3 mode, bucket policy, object receipt, and
  Fly secret staging. Do not fall back to the Fly volume.
- A recovery value is missing: keep the prior deployment live. Do not bypass
  the environment gate.

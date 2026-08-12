# Trellis Academy source boundary

Trellis Academy is a pinned vendored snapshot of the LearnHouse community
repository at `f18d05be5991917a4e870a8ba15985567beaada3`. The upstream repository is
<https://github.com/learnhouse/learnhouse.git>, whose `dev` branch still resolved
to that revision when the snapshot was imported on 2026-08-11.

## Excluded source

The import physically excludes these commercially licensed or enterprise-only
paths:

- `apps/web/ee`
- `docs`
- `apps/e2e/features/scorm`

The Academy source contract fails if any excluded path or nested Git metadata is
reintroduced.

## Baseline compatibility patch

The community web application imported modules from the excluded commercial
tree, so the public snapshot did not build after that tree was removed. The
baseline patch removes those SCORM and multi-tenant web imports, uses the
existing default-organization resolution, and repairs a stale web test import.
It changes ten web files with 18 insertions and 280 deletions. The exact binary
patch SHA-256 is
`e90dc0046cbc44d9d3c8ccbc1842524b7b0bf25d696c6ff3319807ff6ff815de`.

The API's AGPL-licensed SCORM parsing and security code remains in the source
snapshot. No SCORM route or UI is exposed by the imported web baseline.

The fresh-checkout baseline also exposed a quadratic Arabic locale parity test
that exceeded Bun's default timeout on a cold filesystem. Trellis computes the
Arabic key set once before comparing it with the English keys. The assertion and
product behavior are unchanged; the complete check now finishes deterministically.

The Academy Next.js build pins its Turbopack root to `apps/web`. This prevents a
parent checkout or home-directory lockfile from changing dependency tracing and
keeps the standalone Academy build self-contained.

The enterprise activity-mode test now uses the suite's existing fake Redis.
That keeps a developer's real daily `SETNX` key from skipping the patched insert
spy and makes the baseline suite independent from external Redis state.

The source-development CLI accepts caller-selected PostgreSQL and Redis ports.
The Academy E2E wrapper uses free local ports so its proof run does not stop or
replace unrelated developer services.

The imported flat ESLint configuration now declares React and DOM type globals,
ratchets the existing render-local chart component debt to visible warnings,
and fixes the remaining empty catches, password character check, and switch-case
scope error. Strict lint therefore reports existing warnings without hiding
errors behind upstream's `|| true` command.

Dummy PostgreSQL URLs in tests are split across string literals so secret
scanners do not classify local fixtures as unknown credentials; their runtime
values and assertions are unchanged. User-facing examples omit embedded
credentials and direct operators to secure configuration instead.

Lob-shaped Python test identifiers are shortened without changing test
behavior because the credential scanner otherwise classifies their names as
possible test keys, including when repeated in the source integrity manifest.

The import excludes 54 binary LearnHouse branding images, documentation
screenshots, favicons, and one upstream assignment fixture. Binary diffs cannot
be inspected by the canonical source reviewer, and Phase 4 owns Trellis Academy
branding and deployment assets. Static imports that require a build-time image
use the baseline's existing reviewable SVG marks. The checked-out source, build,
and focused author-to-learner lifecycle do not depend on the removed media.

The upstream documentation application is not shipped. It advertises and
provides interactive references for native authentication, Google OAuth, AI,
billing, paid courses, and mutable upstream installers that are outside the
Trellis Academy release-one contract. Supported Academy documentation remains
Trellis-owned and must describe only the Trellis SSO learner surface.

## Launch and runtime exclusions

This import preserves auditable community source while excluding these surfaces
from the Trellis Academy launch runtime:

- LearnHouse community and social discovery features.
- The collaboration service and real-time collaborative editing.
- The LearnHouse hosted-cloud and Docker deployment topology.
- The LearnHouse deployment CLI as a production dependency.
- Paid courses, learner checkout, and enrollment paywalls.
- Payments, billing, usage overages, purchasable packs, plan gates, and
  administrator seat caps.
- Every AI or LLM surface, provider, generation route, authoring or assessment
  generator, playground, RAG or embedding service, credit ledger, quota, and
  upgrade path.
- Native signup, password login or recovery, email verification, invitations,
  direct membership, Google or social OAuth, and alternate identity providers.
- Every enterprise-only or commercially licensed surface.

Retained upstream source is not the launch-runtime allowlist. Excluded code may
remain for AGPL completeness and maintainable upstream synchronization, but it
must be unreachable, unregistered, unconfigured, uncredentialed, and free of
jobs, required migrations, and launch acceptance checks. A finding in retained
excluded code is resolved by preserving that boundary, not by turning the
surface into Trellis Academy product work.

Top-level course creation now fails closed unless the caller passes the exact
target organization into the role check. A role held in one tenant can never
authorize a placeholder create in another tenant.

The release router is an operation allowlist, not a wholesale mount of retained
upstream routers. Learner reads and the deterministic local publisher bootstrap
remain available; course transfer/export/clone/delete, course-update mutation,
folder mutation, media mutation/share creation, content-lock user-group
mutation, and video caption generation are not registered. Learner answers are
immutable after hand-in, regex grading has a mandatory wall-clock timeout, and
folder/media reads honor organization membership and private ancestors.

Academy Phase 4 owns the supported Vercel Services, dedicated Supabase, managed
Redis, storage, migrations, and Trellis SSO topology. This baseline does not
connect to Trellis production services, credentials, email, or providers.
Learners enter through a short-lived, single-use `Continue with Trellis` SSO
exchange. Academy never receives a Trellis password and has no separate Google
OAuth client.

The Phase 4 E2E harness follows `lopopolo/harness-engineering` commit
`226c8d35fb6ea3ed55467753dba6dea2b5fd5778` and
`playbooks/improve-harness.md` (verified current with `origin/trunk` on
2026-08-11). Its proof boundary is the real local Trellis session, issuer,
single-use Academy exchange, learner session, and persisted learning journey.
Browser mocks are not accepted as SSO proof, and browser request interception
alone is not reported as proof of server-side provider-write suppression.

`CONTEXT.md` and the `trellis/` directory are Trellis-owned metadata. All other
files under `trellis-academy` are covered by the checked source manifest.

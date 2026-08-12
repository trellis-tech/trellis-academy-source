# Trellis Academy

Trellis Academy organizes published learning resources and records each
learner's independent participation and progress.

Design authority: root `DESIGN.md`. Academy uses the shared Trellis semantic
tokens and interaction contracts; upstream LearnHouse styling is not a product
variant.

## Release-one boundary

The launch runtime is allowlisted to courses, modules, lessons, video, quizzes,
assignments, progress, certificates, lexical search, and repository-controlled
publication. It excludes every AI or credit feature; payments, billing, plans,
overages, paywalls, and administrator seat caps; and native signup, password,
invitation, Google or social OAuth, and alternate identity providers. Trellis
SSO is the only learner authentication path.

Upstream code retained for license completeness or fork maintenance does not
expand that scope. Excluded code stays unregistered, unconfigured,
uncredentialed, unreachable, and outside launch acceptance and remediation.

## Language

**Curated Path**:
An authored, ordered collection of courses highlighted as a coherent starting
sequence for every learner.
_Avoid_: Learning Path, assigned path, required path

**Learner Trail**:
A learner's private record of enrolled courses and progress through them.
_Avoid_: Curated Path, curriculum, assignment

**Catalog**:
A published collection of courses organized around a durable job or product
domain.
_Avoid_: Learning resource registry, category

**Course**:
A self-enrollable learning resource that develops one capability or job
outcome.
_Avoid_: Track, path

**Module**:
An ordered section within a course that groups related learning activities.
_Avoid_: Course, catalog

**Lesson**:
One learning activity with an observable outcome, which may use documentation,
video, practice, or a knowledge check.
_Avoid_: Video

**Learning Resource Registry**:
The technical index connecting Academy resources, documentation, Help Center
articles, and product routes.
_Avoid_: Catalog

## Baseline verification

Run the Academy checks from the Trellis repository root:

```bash
bun run academy:setup
bun run academy:lint
bun run academy:test
bun run academy:build
E2E_BASE_URL="$ACADEMY_WEB_URL" \
  E2E_API_URL="$ACADEMY_API_URL" \
  bun run academy:e2e
```

The E2E wrapper boots the checked-out Trellis app and Academy web/API against
local Supabase, isolated Academy PostgreSQL and Redis ports, and synthetic
publisher fixtures. It exercises real Trellis SSO and removes generated
credentials and infrastructure. It does not pull or test a published
LearnHouse application image.

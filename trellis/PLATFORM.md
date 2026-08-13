# Academy platform contract

This document is the authority for the pre-curriculum Trellis Academy
platform. It describes the deployed topology, ownership seams, runtime scope,
and evidence required before real courses or modules may be created.

## Deployed topology

The production request path is:

```text
Cloudflare DNS
  -> Vercel web project: trellis-academy
     -> allowlisted /api/v1 proxy
        -> Fly Machines app: trellis-academy-api
           -> dedicated Supabase PostgreSQL and Storage
           -> managed Redis
```

The public DNS name is `academy.trellistech.com`. Provider hostnames and
credentials remain deployment configuration, never source defaults.

The web runtime requires the Academy backend origin and `TRELLIS_APP_URL`. The
API runtime requires its PostgreSQL, storage, Redis, SSO verification, Academy
organization, and session-signing configuration. Production credential values
must stay in Vercel, Fly, and provider secret stores.

Observed on 2026-08-12:

- Cloudflare resolves the Academy name to Vercel's `76.76.21.21` edge.
- the public health request is served by Vercel and proxied through Fly;
- Vercel project `trellis-academy` is linked to the Academy web source;
- Fly app `trellis-academy-api` is deployed on Machines in `iad`;
- production web configuration declares the Trellis issuer and Academy API
  origins.

These observations prove routing and process availability only. They do not
prove database isolation, storage recovery, authentication, publication, or a
learner journey.

## Authority and data ownership

Trellis is the sole identity authority. Academy never accepts or stores a
Trellis password and has no native signup, password recovery, invitation, or
alternate identity-provider flow.

The SSO sequence is Trellis session -> short-lived assertion -> single-use
Redis consumption -> Academy-owned HTTP-only session. Trellis subject activity
is checked at exchange and refresh. Deactivation revokes access without
deleting learning records.

Academy owns:

- its organization and owner/author/learner memberships;
- published learning structures and immutable publication receipts;
- learner enrollment, progress, submissions, grades, and certificates;
- Academy media objects and release metadata.

Trellis owns identity state and the allowlist deciding who may enter Academy.
Repository publication owns reviewed source, deterministic identifiers,
version history, and rollback receipts. The browser is not an authority for
identity, authorization, publication, or completion.

## Runtime exclusions

The launch runtime excludes AI and AI credits, paid courses, billing, plans,
usage calculations, seat caps, Google OAuth, native password auth, invitations,
communities, discussions, playgrounds, podcasts, alternate organization
creation, and every retained enterprise-only surface.

Excluded code may remain in the corresponding source for fork maintenance, but
it must be unregistered, unconfigured, uncredentialed, unreachable, and free
of startup jobs. Excluded web routes return 404 or 410 before their handlers
execute. Excluded API routers are absent from OpenAPI.

Allowed runtime families are Trellis SSO, the fixed Academy organization,
courses, chapters/modules, activities/lessons, blocks, assignments,
certifications, folders, media, learner trail/progress, search, streaming, and
the minimal session readback required by the web shell. Authoring mutations are
added only through the repository publisher and owner policy defined for
Academy; retaining an upstream editor route does not authorize it.

## Design authority

Root `DESIGN.md` and the semantic tokens shipped by Trellis are binding. Academy
does not create a parallel theme or preserve upstream visual conventions.
Product surfaces use Geist, 400/500 weights, neutral canvas and surface ladders,
hairlines, the 8–12px radius system, scarce Trellis teal, both themes, logical
RTL properties, HugeIcons, compact controls, and Trellis accessibility and
motion contracts.

LearnHouse names, logos, watermarks, footer links, sales copy, pricing language,
fixture labels, and multi-organization concepts are migration defects on any
allowed Academy surface.

## Release evidence

Deployment health is not authenticated journey proof. Evidence is recorded by
layer and tied to a Git revision:

| Layer | Required receipt |
| --- | --- |
| Source | reviewed commit, source manifest, provenance, public corresponding-source tag and archive digest |
| Build | platform, source, lint, test, and production build commands on that commit |
| Data | migration head, synthetic publisher receipt, persisted learner readback |
| Identity | fresh and returning SSO, replay denial, rotation, logout, revocation, deactivation, and recovery |
| Operations | Vercel deployment, Fly image/release, health, logs, backup, restore rehearsal, and rollback target |
| Product | owner publish/rollback and learner resume/assessment/certificate browser journey |
| Safety | zero skipped acceptance gates and process-level proof of zero unintended external writes |

The containing production deployment must identify the reviewed Academy source.
An alias manually pointed at an unreviewed build is not a release receipt.

## Recovery gates

Redis carries disposable exchange and replay state, not learning records. Redis
loss fails exchanges closed and requires a new Trellis login; it must not invent
or delete Academy membership or learner progress.

Supabase PostgreSQL and Storage are durable Academy data. Before release:

1. record the migration head and provider backup/PITR configuration;
2. create a database backup without exposing credentials;
3. restore it into an isolated non-production target;
4. read back the fixed organization, synthetic publication receipt, learner
   progress, submission, and certificate fixtures;
5. verify referenced media objects or record that the fixture contains none;
6. destroy the isolated target after retaining a redacted receipt.

Rollback re-deploys the last verified Vercel build and Fly image by immutable
identifier. Schema rollback is expand/migrate/contract: application rollback
must remain compatible with the deployed schema. Destructive downgrade SQL is
not an automatic recovery mechanism.

Corresponding source follows `SOURCE_RELEASE.md`. Backup, restore, rollback,
and corresponding source require release receipts at the exact reviewed head;
written procedures alone do not satisfy these gates.

Current recovery status (verified 2026-08-13): the isolated database restore
receipt is retained at `trellis/evidence/2026-08-12-database-restore.json`;
the production release records immutable Fly and Vercel rollback targets; and
the public corresponding-source archive is independently checksum-verified.
Release `9717e17b862375d17419af7b5ab9efe65c3d7d44` passed the fresh-checkout
journey, recovery gates, migration and storage checks, compensated promotion,
publication readback, and Michel-only authenticated production replay.
Curriculum remains the next phase.

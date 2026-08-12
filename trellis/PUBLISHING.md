# Academy owner publishing workflow

Academy publishing is repository-authoritative. The browser is for reviewing
the owner boundary and learner result; it never receives a publisher secret or
becomes a general-purpose CMS.

## Before curriculum begins

The only source manifest is `trellis-academy/content/academy.yaml`. Its current
course, module, lesson, and quiz are synthetic acceptance fixtures. They may be
published, rolled back, and republished to prove the platform, but they are not
Trellis curriculum.

Michel enters at `/login` with the existing Trellis session, then uses `/owner`
to verify owner identity and the release boundary. `/courses` shows the learner
projection. There is no Academy password, Google login, billing setup, seat
configuration, AI authoring, or browser admin dashboard.

Real course and module editing remains locked until the platform release gates
in `PLATFORM.md` are green.

## Future editing model

When curriculum begins, an author changes the YAML manifest through a normal
reviewed pull request:

1. Give every course, module, lesson, and assessment a stable human-readable
   source ID. Renaming an ID creates a different resource.
2. Keep graph references explicit: catalog -> course -> module -> lesson ->
   assessment.
3. Put localized copy under `locales`; a published graph must contain every
   required locale.
4. Mark unfinished courses `draft`. Publication status is source-controlled,
   not toggled in the browser.
5. Run `bun run academy:content-check` and the full Academy release checks.
6. Review the generated create/update/retain/archive plan before production.
7. Merge only after the exact-head checks and autoreview are green.

The compiler produces deterministic Academy-native IDs and a graph digest.
Course, module, and lesson IDs remain stable by source ID. Assessment native
IDs additionally include the canonical assessment-definition digest, so a
changed question or option creates a new assignment/task version. The prior
version and its submissions remain immutable; rollback reactivates that exact
prior version instead of rewriting learner history.
Publication succeeds only when API readback matches that digest. The immutable
receipt binds the operator instruction, source commit, release tag, native IDs,
readback digest, and rollback target.

## Synthetic acceptance lifecycle

`bun run academy:e2e` is the canonical safe proof. It:

- publishes the synthetic manifest through the real local publisher;
- reads the course and quiz as a Trellis learner;
- persists progress and grade state;
- rolls the release back without deleting learner history;
- republishes and verifies the final digest;
- proves zero unintended external writes.

Production publication uses the same API contract with the publisher secret
held by the `academy-production` GitHub environment. Never paste that secret
into the browser, a shell transcript, a pull request, or a content manifest.
The deployment workflow discovers the current immutable release from the
publisher API, uses it as the rollback target, publishes only the reviewed
commit's compiled graph, and retains the readback receipt as an artifact.

## Rollback rules

A publication rollback targets an immutable prior release tag and creates a new
receipt; it does not rewrite or delete old receipts. The API archives resources
that are absent from the target graph and verifies the target digest after the
transaction. Identity, enrollment, progress, submissions, grades, and
certificates are protected runtime state and are never rolled back with
curriculum.

Application deployment rollback is separate from publication rollback. Follow
`OPERATIONS.md` for Vercel, Fly, migration, database, and storage recovery.

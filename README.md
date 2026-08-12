# Trellis Academy

Trellis Academy is the private-preview learning platform for Trellis operators.
Trellis owns identity, publication policy, product design, deployment, and
release evidence. The Academy runtime owns learning sessions, published
learning resources, assessments, certificates, and learner progress.

The current program is completing the platform before creating the real
curriculum. Synthetic courses and activities are fixtures used to prove the
author-to-learner lifecycle; they are not launch content.

## Supported platform

- Trellis SSO is the only authentication path.
- The release runtime is explicitly allowlisted to authoring, publication,
  courses, lessons, assessments, progress, certificates, search, and media.
- Repository-controlled publication remains the source of release receipts and
  rollback evidence.
- Root `DESIGN.md` governs every Academy product surface.

AI features, paid courses, billing, plans, administrator seat limits, native
password accounts, Google OAuth, communities, discussions, playgrounds, and
podcasts are not Trellis Academy products.

## Start here

- [Platform architecture and release gates](trellis/PLATFORM.md)
- [Owner publishing workflow](trellis/PUBLISHING.md)
- [Deployment, access, backup, restore, and rollback](trellis/OPERATIONS.md)
- [Academy domain language and release boundary](CONTEXT.md)
- [Trellis modifications to the upstream source](trellis/MODIFICATIONS.md)
- [Corresponding-source release procedure](trellis/SOURCE_RELEASE.md)
- [Local E2E harness](apps/e2e/README.md)

Run the source-controlled checks from the Trellis repository root:

```bash
bun run academy:platform-check
bun run academy:source-check
bun run academy:lint
bun run academy:test
bun run academy:build
bun run academy:e2e
```

Each command proves only its named layer. A build or health response is not a
substitute for an authenticated journey, persisted data readback, recovery
receipt, reviewed source release, or containing-deployment verification.

## Upstream and license

Trellis Academy is based on a pinned snapshot of the LearnHouse community
repository. The upstream revision, excluded paths, archive digest, and Trellis
compatibility patch are recorded in `trellis/provenance.json` and
`trellis/MODIFICATIONS.md`.

The Academy source is distributed under the [GNU Affero General Public License
v3](LICENSE). Every deployed revision must follow
`trellis/SOURCE_RELEASE.md`; retaining this notice does not by itself satisfy
the corresponding-source release gate.

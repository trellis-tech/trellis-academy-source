# Trellis Academy local E2E

This suite is the fresh-checkout acceptance gate for the pre-curriculum Trellis
Academy platform. It exercises Trellis-owned identity and the real local
Academy source. It does not use Academy passwords, a browser SSO mock, preview
credentials, or production providers.

## What the wrapper boots

Run from the Trellis repository root:

```bash
bun run academy:setup
bun run academy:e2e
```

The wrapper allocates loopback ports and starts:

- local Supabase for the Trellis identity fixture;
- the real `trellis-app` SSO issuer;
- Academy PostgreSQL and Redis containers;
- the Academy API, web app, and collaboration process from this checkout.

It creates temporary environment files, uses synthetic identities and content,
then removes containers, files, and processes on success or failure. It refuses
to overwrite existing local environment files or reuse existing Academy
containers.

Prerequisites are Bun, Node 24, `uv`, Docker, OpenSSL, the Supabase CLI, and the
Chromium installed by `bun run academy:setup`.

## Proof boundary

The suite proves:

1. a synthetic Trellis session enters the real Trellis issuer;
2. Academy atomically consumes the short-lived assertion and creates its own
   HTTP-only session;
3. the original safe learner deep link survives the exchange;
4. repository-controlled synthetic content is published through the Academy
   publisher and read back from the learner UI;
5. the learner starts a course, saves and submits a quiz, reloads, resumes, and
   reads persisted progress and grade state;
6. assertion replay, unsafe destinations, native Academy auth, excluded product
   routes, logout, token rotation, and deactivated identity are denied;
7. deactivation removes access without deleting learning records;
8. the synthetic release is rolled back and republished with receipt readback;
9. process-level guards observe zero non-loopback writes from browser and server
   processes.

The current feature module is
`features/trellis-sso/01-learner-journey.spec.ts` plus the parameterized denial
matrix in `02-denials.spec.ts`. Playwright retains traces, screenshots, and
video for failures.

## Focused iteration

After the wrapper has booted the local stack, a focused browser rerun can use:

```bash
cd trellis-academy/apps/e2e
E2E_SKIP_BOOT=1 bunx playwright test features/trellis-sso --project=chromium
```

`E2E_BASE_URL`, `E2E_API_URL`, and `E2E_TRELLIS_URL` may point only to the
loopback stack. The runtime contract rejects non-loopback origins so this suite
cannot accidentally exercise preview or production.

## Evidence limits

A green local run proves the exact checked-out source against disposable local
services. It does not prove GitHub checks, a Vercel or Fly deployment, DNS,
production backup/restore, corresponding-source publication, or Michel's
authenticated production journey. Those are separate release receipts in
`trellis/PLATFORM.md` and `trellis/OPERATIONS.md`.

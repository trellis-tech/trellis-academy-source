'use client'

import BoundaryError from '@components/Objects/StyledElements/Error/BoundaryError'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // BoundaryError captures to Sentry (keeping the event id for the report
  // button), auto-reloads on stale-deploy errors, and renders the meaningful
  // ErrorUI with recovery actions (retry / home / sign out / report).
  return <BoundaryError error={error} reset={reset} />
}

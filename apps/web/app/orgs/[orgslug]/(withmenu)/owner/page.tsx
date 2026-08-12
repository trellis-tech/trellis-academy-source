import {
  ArrowSquareOut,
  CheckCircle,
  GitBranch,
  ShieldCheck,
  Stack,
} from '@phosphor-icons/react/dist/ssr'
import { notFound, redirect } from 'next/navigation'

import {
  getAcademyServerSession,
  hasAcademyRefreshSession,
} from '@/lib/auth/server'

const stages = [
  {
    title: 'Repository source',
    detail: 'Validated manifests are the authority for every authored resource.',
    status: 'Ready',
    Icon: GitBranch,
  },
  {
    title: 'Staged projection',
    detail: 'Drafts stay private until graph readback matches the compiled digest.',
    status: 'Protected',
    Icon: Stack,
  },
  {
    title: 'Release receipt',
    detail: 'Every publish records its revision, native IDs, readback, and rollback target.',
    status: 'Required',
    Icon: ShieldCheck,
  },
]

export default async function AcademyOwnerPage() {
  const session = await getAcademyServerSession()
  if (!session) {
    if (await hasAcademyRefreshSession()) {
      redirect('/api/auth/refresh?destination=%2Fowner')
    }
    redirect('/login?next=%2Fowner')
  }
  if (session.academy_role !== 'owner') notFound()

  const ownerName = [session.user.first_name, session.user.last_name]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
      <div className="flex flex-col gap-8">
        <header className="flex flex-col justify-between gap-5 border-b border-border pb-8 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-academy-accent">
              Owner workspace
            </p>
            <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
              Publishing workspace
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
              Prepare and verify Academy releases without granting the browser raw CMS or learner-data authority.
            </p>
          </div>
          <div className="text-sm md:text-end">
            <p className="font-medium">{ownerName || 'Academy owner'}</p>
            <p className="mt-1 text-muted-foreground">{session.user.email}</p>
          </div>
        </header>

        <section aria-labelledby="release-boundary-heading">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-medium" id="release-boundary-heading">
                Release boundary
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The platform fixture is synthetic. Curriculum has not started.
              </p>
            </div>
            <span className="inline-flex min-h-8 items-center gap-2 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground">
              <CheckCircle aria-hidden="true" className="text-academy-accent" size={16} weight="fill" />
              Draft only
            </span>
          </div>

          <div className="grid border-y border-border md:grid-cols-3 md:divide-x md:divide-border">
            {stages.map(({ title, detail, status, Icon }) => (
              <article className="py-6 md:px-6 md:first:ps-0 md:last:pe-0" key={title}>
                <div className="mb-5 flex items-start justify-between gap-4">
                  <span className="flex size-9 items-center justify-center rounded-md bg-accent text-academy-accent">
                    <Icon aria-hidden="true" size={19} weight="duotone" />
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">{status}</span>
                </div>
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-5 border-b border-border pb-8 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h2 className="text-lg font-medium">Content comes last</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Course, module, lesson, video, and translation work remains locked until identity, publishing, recovery, deployment, and authenticated E2E gates are green.
            </p>
          </div>
          <a
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-academy-accent"
            href="/courses"
          >
            View learner catalog
            <ArrowSquareOut aria-hidden="true" size={17} />
          </a>
        </section>
      </div>
    </div>
  )
}

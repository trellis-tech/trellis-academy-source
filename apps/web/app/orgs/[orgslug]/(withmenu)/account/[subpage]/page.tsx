import { ArrowSquareOut, IdentificationCard, ShieldCheck, SignOut } from '@phosphor-icons/react/dist/ssr'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { getAcademyServerSession } from '@/lib/auth/server'
import { configuredHttpUrl } from '@services/auth/trellisLaunch'

export const metadata: Metadata = {
  title: 'Account — Trellis Academy',
  description: 'Your Trellis Academy identity and access.',
  robots: { index: false, follow: false },
}

export default async function AcademyAccountPage({
  params,
}: {
  params: Promise<{ subpage: string }>
}) {
  const { subpage } = await params
  if (subpage !== 'general') notFound()

  const session = await getAcademyServerSession()
  if (!session) redirect('/login?next=%2Faccount%2Fgeneral')
  const displayName = [session.user.first_name, session.user.last_name].filter(Boolean).join(' ')
  const role = session.academy_role === 'owner' ? 'Academy owner' : 'Learner'
  const trellisAppUrl = configuredHttpUrl('TRELLIS_APP_URL')

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:py-10">
      <header className="border-b border-border pb-6">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-academy-accent">Trellis identity</p>
        <h1 className="mt-2 text-2xl font-medium tracking-[-0.02em] text-foreground">Account</h1>
        <p className="mt-2 text-sm text-muted-foreground">Academy access follows your Trellis account. Passwords and identity settings are never stored here.</p>
      </header>

      <section aria-labelledby="identity-heading" className="grid gap-5 border-b border-border py-6 sm:grid-cols-[auto_1fr]">
        <span className="flex size-10 items-center justify-center rounded-md bg-accent text-academy-accent">
          <IdentificationCard aria-hidden="true" size={21} weight="duotone" />
        </span>
        <div>
          <h2 className="text-sm font-medium text-foreground" id="identity-heading">Signed in with Trellis</h2>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Name</dt><dd className="mt-1 font-medium text-foreground">{displayName || 'Trellis user'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Email</dt><dd className="mt-1 font-medium text-foreground">{session.user.email}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Academy role</dt><dd className="mt-1 font-medium text-foreground">{role}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Identity authority</dt><dd className="mt-1 inline-flex items-center gap-1.5 font-medium text-foreground"><ShieldCheck aria-hidden="true" className="text-academy-accent" size={15} />Trellis</dd></div>
          </dl>
        </div>
      </section>

      <section className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-medium text-foreground">Manage your identity in Trellis</h2>
          <p className="mt-1 text-sm text-muted-foreground">Name, email, security, and account status remain controlled by Trellis App.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {trellisAppUrl ? (
            <a className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-accent" href={trellisAppUrl.href} rel="noreferrer">
              Open Trellis
              <ArrowSquareOut aria-hidden="true" size={14} />
            </a>
          ) : null}
          <Link className="inline-flex h-8 items-center gap-2 rounded-md bg-foreground px-3 text-xs font-medium text-background" href="/api/auth/trellis/logout">
            <SignOut aria-hidden="true" size={14} />
            Sign out
          </Link>
        </div>
      </section>
    </div>
  )
}

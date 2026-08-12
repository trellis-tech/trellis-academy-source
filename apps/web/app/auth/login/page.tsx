import { normalizeLearnerDestination } from '@services/auth/trellisLaunch'

interface LoginPageProps {
  searchParams: Promise<{ next?: string | string[] }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const requested = Array.isArray(params.next) ? params.next[0] : params.next
  const destination = normalizeLearnerDestination(requested)

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground sm:px-6">
      <section className="w-full max-w-sm rounded-lg border border-border bg-card p-6 sm:p-8">
        <img alt="" className="size-9" height="36" src="/icon.svg" width="36" />
        <p className="mt-6 text-xs font-medium uppercase tracking-[0.14em] text-academy-accent">Trellis Academy</p>
        <h1 className="mt-2 text-2xl font-medium tracking-[-0.02em]">Continue learning</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Use your existing Trellis account. Trellis is the only sign-in.</p>
        <form action="/api/auth/trellis/start" method="get" className="mt-8">
          <input type="hidden" name="destination" value={destination} />
          <button
            type="submit"
            className="flex h-9 w-full items-center justify-center rounded-md bg-academy-accent px-4 text-sm font-medium text-white outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-academy-accent focus-visible:ring-offset-2 active:brightness-90"
          >
            Continue with Trellis
          </button>
        </form>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">You will return to the Academy page you requested after Trellis verifies your account.</p>
      </section>
    </main>
  )
}

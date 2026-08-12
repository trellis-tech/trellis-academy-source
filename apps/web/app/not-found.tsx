import { ArrowLeft, Books } from '@phosphor-icons/react/dist/ssr'
import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-16 text-foreground">
      <section className="w-full max-w-xl border-y border-border py-10 text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-md bg-accent text-academy-accent">
          <Books aria-hidden="true" size={22} weight="duotone" />
        </span>
        <p className="mt-6 text-xs font-medium uppercase tracking-[0.16em] text-academy-accent">
          Trellis Academy
        </p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight sm:text-4xl">
          This page is not available
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
          The address may be outdated, or this surface is not part of the Academy.
        </p>
        <Link
          className="mx-auto mt-7 inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-academy-accent"
          href="/courses"
        >
          <ArrowLeft aria-hidden="true" size={17} />
          Back to courses
        </Link>
      </section>
    </main>
  )
}

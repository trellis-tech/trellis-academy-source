'use client'

import { BookOpen, SignIn } from '@phosphor-icons/react'
import Link from 'next/link'

import AcademyCourseCard, { type AcademyCourseSummary } from '@components/Academy/AcademyCourseCard'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getUriWithOrg } from '@services/config/config'

function isCourseSummary(value: unknown): value is AcademyCourseSummary {
  if (value === null || typeof value !== 'object') return false
  return 'course_uuid' in value
    && typeof value.course_uuid === 'string'
    && 'name' in value
    && typeof value.name === 'string'
}

export default function LandingClassic({
  courses,
  orgslug,
  orgUuid,
}: {
  courses: unknown
  orgslug: string
  orgUuid?: string
}) {
  const session = useLHSession()
  const visibleCourses = Array.isArray(courses)
    ? courses.filter(isCourseSummary).slice(0, 6)
    : []

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <header className="border-b border-border pb-6">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-academy-accent">Trellis Academy</p>
        <h1 className="mt-2 text-2xl font-medium tracking-[-0.02em] text-foreground">Learn Trellis</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Product training and operating guidance for teams using Trellis.
        </p>
      </header>

      {visibleCourses.length > 0 ? (
        <>
          <div className="grid gap-4 py-6 sm:grid-cols-2 lg:grid-cols-3">
            {visibleCourses.map((course) => (
              <AcademyCourseCard course={course} key={course.course_uuid} orgUuid={orgUuid} orgslug={orgslug} />
            ))}
          </div>
          <Link className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-accent" href={getUriWithOrg(orgslug, '/courses')}>
            View all courses
          </Link>
        </>
      ) : (
        <section className="my-6 flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 text-center">
          <BookOpen aria-hidden="true" className="text-academy-accent" size={30} weight="duotone" />
          <h2 className="mt-4 text-base font-medium text-foreground">
            {session?.status === 'authenticated' ? 'Curriculum is coming next' : 'Sign in to Trellis Academy'}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            The Academy platform is being completed before the real course catalog is published.
          </p>
          {session?.status !== 'authenticated' ? (
            <Link className="mt-5 inline-flex h-8 items-center gap-2 rounded-md bg-foreground px-3 text-xs font-medium text-background" href={getUriWithOrg(orgslug, '/login')}>
              <SignIn aria-hidden="true" size={15} />
              Continue with Trellis
            </Link>
          ) : null}
        </section>
      )}
    </main>
  )
}

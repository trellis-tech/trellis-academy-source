'use client'

import { BookOpen, MagnifyingGlass, SignIn, X } from '@phosphor-icons/react'
import Link from 'next/link'
import { useMemo, useState } from 'react'

import { useCourses } from '@/hooks/queries/useCourses'
import AcademyCourseCard, { type AcademyCourseSummary } from '@components/Academy/AcademyCourseCard'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { searchMatchesAny } from '@/lib/search/normalize'

function isCourseSummary(value: unknown): value is AcademyCourseSummary {
  if (value === null || typeof value !== 'object') return false
  return 'course_uuid' in value
    && typeof value.course_uuid === 'string'
    && 'name' in value
    && typeof value.name === 'string'
}

export default function Courses({ orgslug }: { orgslug: string }) {
  const [query, setQuery] = useState('')
  const org = useOrg()
  const session = useLHSession()
  const { data, isLoading } = useCourses(orgslug)
  const courses = useMemo(
    () => Array.isArray(data) ? data.filter(isCourseSummary) : [],
    [data],
  )
  const filtered = useMemo(() => {
    const normalized = query.trim()
    if (!normalized) return courses
    return courses.filter((course) =>
      searchMatchesAny([course.name, course.description ?? ''], normalized),
    )
  }, [courses, query])
  const orgUuid = org?.org_uuid

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <header className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-academy-accent">Academy catalog</p>
          <h1 className="mt-2 text-2xl font-medium tracking-[-0.02em] text-foreground">Courses</h1>
          <p className="mt-2 text-sm text-muted-foreground">Trellis product training and operating guidance.</p>
        </div>
        {courses.length > 0 ? (
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">Search courses</span>
            <MagnifyingGlass aria-hidden="true" className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
            <input
              className="h-9 w-full rounded-md border border-border bg-card ps-9 pe-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-academy-accent"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search courses"
              type="search"
              value={query}
            />
            {query ? (
              <button
                aria-label="Clear course search"
                className="absolute end-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setQuery('')}
                type="button"
              >
                <X aria-hidden="true" size={14} />
              </button>
            ) : null}
          </label>
        ) : null}
      </header>

      {isLoading ? (
        <div aria-label="Loading courses" className="grid gap-4 py-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="h-64 animate-pulse rounded-lg border border-border bg-card" key={index} />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid gap-4 py-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((course) => (
            <AcademyCourseCard course={course} key={course.course_uuid} orgUuid={orgUuid} orgslug={orgslug} />
          ))}
        </div>
      ) : (
        <section className="my-6 flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 text-center">
          <BookOpen aria-hidden="true" className="text-academy-accent" size={30} weight="duotone" />
          <h2 className="mt-4 text-base font-medium text-foreground">
            {query ? 'No matching courses' : session?.status === 'authenticated' ? 'Curriculum is coming next' : 'Sign in to view Academy courses'}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            {query ? 'Try a different title or keyword.' : 'The platform is being completed before Trellis publishes the real course catalog.'}
          </p>
          {session?.status !== 'authenticated' && !query ? (
            <Link className="mt-5 inline-flex h-8 items-center gap-2 rounded-md bg-foreground px-3 text-xs font-medium text-background" href={getUriWithOrg(orgslug, '/login')}>
              <SignIn aria-hidden="true" size={15} />
              Continue with Trellis
            </Link>
          ) : null}
        </section>
      )}
    </div>
  )
}

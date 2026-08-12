'use client'

import { ChartLineUp } from '@phosphor-icons/react'

import { useTrail } from '@/hooks/queries/useTrail'
import { useOrg } from '@components/Contexts/OrgContext'
import TrailCourseCard from '@components/Pages/Trail/TrailCourseCard'
import UserCertificates from '@components/Pages/Trail/UserCertificates'

interface TrailCourse {
  course_uuid: string
  name: string
  thumbnail_image?: string | null
}

interface TrailRun {
  course: TrailCourse
  course_total_steps?: number
  steps?: unknown[]
}

function isTrailRun(value: unknown): value is TrailRun {
  if (value === null || typeof value !== 'object' || !('course' in value)) return false
  const course = value.course
  return course !== null
    && typeof course === 'object'
    && 'course_uuid' in course
    && typeof course.course_uuid === 'string'
    && 'name' in course
    && typeof course.name === 'string'
}

export default function Trail({ orgslug }: { orgslug: string }) {
  const org = useOrg()
  const { data, isLoading, error } = useTrail(org?.id)
  const runs = data && typeof data === 'object' && 'runs' in data && Array.isArray(data.runs)
    ? data.runs.filter(isTrailRun)
    : []

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <header className="border-b border-border pb-6">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-academy-accent">Learning record</p>
        <h1 className="mt-2 text-2xl font-medium tracking-[-0.02em] text-foreground">Progress</h1>
        <p className="mt-2 text-sm text-muted-foreground">Resume courses and review durable completion records.</p>
      </header>

      <section aria-labelledby="active-learning" className="py-6">
        <h2 className="mb-3 text-sm font-medium text-foreground" id="active-learning">Course progress</h2>
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <div className="h-64 animate-pulse rounded-lg border border-border bg-card" key={index} />)}</div>
        ) : error ? (
          <EmptyProgress message="Progress is temporarily unavailable. Please refresh and try again." />
        ) : runs.length === 0 ? (
          <EmptyProgress message="Start a course to see your progress here." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{runs.map((run: TrailRun) => <TrailCourseCard course={run.course} key={run.course.course_uuid} orgslug={orgslug} run={run} />)}</div>
        )}
      </section>

      <section aria-labelledby="certificates" className="border-t border-border pt-6">
        <h2 className="sr-only" id="certificates">Certificates</h2>
        <UserCertificates orgslug={orgslug} />
      </section>
    </div>
  )
}

function EmptyProgress({ message }: { message: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 text-center">
      <ChartLineUp aria-hidden="true" className="text-academy-accent" size={28} weight="duotone" />
      <p className="mt-3 text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

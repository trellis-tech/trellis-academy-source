'use client'

import { ArrowRight, BookOpen, CheckCircle } from '@phosphor-icons/react'
import Link from 'next/link'

import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'

interface ProgressCourse {
  course_uuid: string
  name: string
  thumbnail_image?: string | null
}

interface ProgressRun {
  course_total_steps?: number
  steps?: unknown[]
}

export default function TrailCourseCard({
  course,
  run,
  orgslug,
}: {
  course: ProgressCourse
  run: ProgressRun
  orgslug: string
}) {
  const org = useOrg()
  const completedSteps = Array.isArray(run.steps) ? run.steps.length : 0
  const totalSteps = typeof run.course_total_steps === 'number' ? run.course_total_steps : 0
  const progress = totalSteps > 0 ? Math.min(100, Math.round((completedSteps / totalSteps) * 100)) : 0
  const href = getUriWithOrg(orgslug, `/course/${course.course_uuid.replace('course_', '')}`)
  const thumbnail = course.thumbnail_image && org?.org_uuid
    ? getCourseThumbnailMediaDirectory(org.org_uuid, course.course_uuid, course.thumbnail_image)
    : null

  return (
    <Link className="group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card outline-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-academy-accent" href={href}>
      <div className="relative flex aspect-video items-center justify-center overflow-hidden border-b border-border bg-accent">
        {thumbnail ? <img alt="" className="size-full object-cover" src={thumbnail} /> : <BookOpen aria-hidden="true" className="text-academy-accent" size={30} weight="duotone" />}
        <div className="absolute inset-x-0 bottom-0 h-1 bg-border"><div className="h-full bg-academy-accent" style={{ width: `${progress}%` }} /></div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h2 className="text-sm font-medium tracking-[-0.02em] text-foreground" dir="auto">{course.name}</h2>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{completedSteps} of {totalSteps} lessons</span>
          <span className="font-medium text-foreground">{progress}%</span>
        </div>
        <div className="mt-5 flex items-center gap-1.5 border-t border-border pt-3 text-xs font-medium text-muted-foreground group-hover:text-foreground">
          {progress === 100 ? <CheckCircle aria-hidden="true" className="text-academy-accent" size={15} weight="fill" /> : <ArrowRight aria-hidden="true" size={14} />}
          {progress === 100 ? 'Completed' : 'Continue learning'}
        </div>
      </div>
    </Link>
  )
}

import { ArrowRight, BookOpen } from '@phosphor-icons/react'
import Link from 'next/link'

import { getUriWithOrg } from '@services/config/config'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'

export interface AcademyCourseSummary {
  course_uuid: string
  name: string
  description?: string | null
  thumbnail_image?: string | null
}

export default function AcademyCourseCard({
  course,
  orgslug,
  orgUuid,
}: {
  course: AcademyCourseSummary
  orgslug: string
  orgUuid?: string
}) {
  const courseId = course.course_uuid.replace('course_', '')
  const href = getUriWithOrg(orgslug, `/course/${courseId}`)
  const thumbnail = course.thumbnail_image && orgUuid
    ? getCourseThumbnailMediaDirectory(orgUuid, course.course_uuid, course.thumbnail_image)
    : null

  return (
    <Link
      className="group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card outline-none transition-colors hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-academy-accent"
      href={href}
      prefetch={false}
    >
      <div className="flex aspect-video items-center justify-center overflow-hidden border-b border-border bg-accent">
        {thumbnail ? (
          <img
            alt=""
            className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transform-none"
            src={thumbnail}
          />
        ) : (
          <BookOpen aria-hidden="true" className="text-academy-accent" size={30} weight="duotone" />
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h2 className="text-sm font-medium tracking-[-0.02em] text-foreground" dir="auto">
          {course.name}
        </h2>
        {course.description ? (
          <p className="mt-2 line-clamp-2 text-sm leading-5 text-muted-foreground" dir="auto">
            {course.description}
          </p>
        ) : null}
        <span className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground group-hover:text-foreground">
          Open course
          <ArrowRight aria-hidden="true" size={14} />
        </span>
      </div>
    </Link>
  )
}

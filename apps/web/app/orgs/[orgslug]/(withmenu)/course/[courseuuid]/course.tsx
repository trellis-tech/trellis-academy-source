'use client'

import { ArrowLeft, ArrowRight, BookOpen, CheckCircle, FileText, Lock, PlayCircle } from '@phosphor-icons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { useTrail } from '@/hooks/queries/useTrail'
import { queryKeys } from '@/lib/query/keys'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { startCourse } from '@services/courses/activity'
import { getCourseMetadata } from '@services/courses/courses'
import { getCourseThumbnailMediaDirectory } from '@services/media/media'

interface AcademyActivity {
  activity_uuid: string
  name: string
  activity_type?: string
}

interface AcademyChapter {
  chapter_uuid: string
  name: string
  activities: AcademyActivity[]
}

interface AcademyCourse {
  course_uuid: string
  name: string
  description?: string
  about?: string
  learnings?: string
  thumbnail_image?: string
  chapters: AcademyChapter[]
}

interface TrailStep {
  activity_id?: string | number
  complete?: boolean
}

interface TrailRun {
  course?: { course_uuid?: string }
  steps?: TrailStep[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function normalizeActivity(value: unknown): AcademyActivity | null {
  if (!isRecord(value)) return null
  const activityUuid = text(value.activity_uuid)
  const name = text(value.name)
  if (!activityUuid || !name) return null
  return { activity_uuid: activityUuid, name, activity_type: text(value.activity_type) }
}

function normalizeChapter(value: unknown): AcademyChapter | null {
  if (!isRecord(value)) return null
  const chapterUuid = text(value.chapter_uuid)
  const name = text(value.name)
  if (!chapterUuid || !name) return null
  const activities = Array.isArray(value.activities)
    ? value.activities.map(normalizeActivity).filter((activity): activity is AcademyActivity => activity !== null)
    : []
  return { chapter_uuid: chapterUuid, name, activities }
}

function normalizeCourse(value: unknown): AcademyCourse | null {
  if (!isRecord(value)) return null
  const courseUuid = text(value.course_uuid)
  const name = text(value.name)
  if (!courseUuid || !name) return null
  const chapters = Array.isArray(value.chapters)
    ? value.chapters.map(normalizeChapter).filter((chapter): chapter is AcademyChapter => chapter !== null)
    : []
  return {
    course_uuid: courseUuid,
    name,
    description: text(value.description),
    about: text(value.about),
    learnings: text(value.learnings),
    thumbnail_image: text(value.thumbnail_image),
    chapters,
  }
}

function normalizeTrailRuns(value: unknown): TrailRun[] {
  if (!isRecord(value) || !Array.isArray(value.runs)) return []
  return value.runs.filter((run): run is TrailRun => isRecord(run))
}

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}

function learningOutcomes(value?: string): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.flatMap((item) => {
        if (typeof item === 'string') return [item]
        if (isRecord(item) && typeof item.text === 'string') return [item.text]
        return []
      }).filter(Boolean)
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) console.error('Failed to read course outcomes', error)
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

export default function CourseClient({ courseuuid, orgslug }: { courseuuid: string; orgslug: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const session = useLHSession()
  const org = useOrg()
  const [actionError, setActionError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const accessToken = session?.data?.tokens?.access_token
  const { data, error, isLoading } = useQuery({
    queryKey: queryKeys.courses.meta(courseuuid),
    queryFn: () => getCourseMetadata(courseuuid, {}, accessToken, { slim: true }),
    enabled: Boolean(courseuuid && accessToken),
    staleTime: 60_000,
  })
  const course = normalizeCourse(data)
  const { data: trailData } = useTrail(typeof org?.id === 'number' ? org.id : undefined)
  const runs = normalizeTrailRuns(trailData)
  const courseId = course ? stripPrefix(course.course_uuid, 'course_') : courseuuid
  const activeRun = runs.find((run) => stripPrefix(run.course?.course_uuid ?? '', 'course_') === courseId)
  const completedIds = new Set(
    (activeRun?.steps ?? [])
      .filter((step) => step.complete)
      .map((step) => String(step.activity_id ?? '')),
  )
  const activities = course?.chapters.flatMap((chapter) => chapter.activities) ?? []
  const firstActivity = activities[0]
  const resumeActivity = activities.find((activity) => {
    const id = stripPrefix(activity.activity_uuid, 'activity_')
    return !completedIds.has(id) && !completedIds.has(activity.activity_uuid)
  }) ?? firstActivity
  const outcomes = learningOutcomes(course?.learnings)
  const thumbnail = course?.thumbnail_image && org?.org_uuid
    ? getCourseThumbnailMediaDirectory(org.org_uuid, course.course_uuid, course.thumbnail_image)
    : null

  async function beginCourse() {
    if (!accessToken || !course) {
      router.push(getUriWithOrg(orgslug, `/login?next=/course/${courseuuid}`))
      return
    }
    if (!resumeActivity) {
      setActionError('This course does not have a published lesson yet.')
      return
    }
    setActionError(null)
    setIsStarting(true)
    try {
      if (!activeRun) {
        await startCourse(`course_${courseId}`, orgslug, accessToken)
        if (typeof org?.id === 'number') {
          await queryClient.invalidateQueries({ queryKey: queryKeys.trail.org(org.id) })
        }
      }
      router.push(getUriWithOrg(orgslug, `/course/${courseId}/activity/${stripPrefix(resumeActivity.activity_uuid, 'activity_')}`))
    } catch (startError) {
      console.error('Failed to start Academy course', startError)
      setActionError('The course could not be started. Please try again.')
    } finally {
      setIsStarting(false)
    }
  }

  if (isLoading || session?.status === 'loading') return <CourseSkeleton />

  if (error || !course) {
    return (
      <CourseState
        description="This course is unavailable or you no longer have access."
        orgslug={orgslug}
        title="Course unavailable"
      />
    )
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <Link className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground" href={getUriWithOrg(orgslug, '/courses')}>
        <ArrowLeft aria-hidden="true" size={14} /> Courses
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0">
          <div className="flex aspect-[16/7] items-center justify-center overflow-hidden rounded-lg border border-border bg-accent">
            {thumbnail ? <img alt="" className="size-full object-cover" src={thumbnail} /> : <BookOpen aria-hidden="true" className="text-academy-accent" size={44} weight="duotone" />}
          </div>
          <header className="border-b border-border py-6">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-academy-accent">Trellis Academy</p>
            <h1 className="mt-2 text-3xl font-medium tracking-[-0.03em] text-foreground" dir="auto">{course.name}</h1>
            {course.description ? <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground" dir="auto">{course.description}</p> : null}
          </header>

          {course.about ? <section className="border-b border-border py-6"><h2 className="text-sm font-medium text-foreground">About this course</h2><p className="mt-3 whitespace-pre-line text-sm leading-6 text-muted-foreground" dir="auto">{course.about}</p></section> : null}

          {outcomes.length > 0 ? (
            <section className="border-b border-border py-6">
              <h2 className="text-sm font-medium text-foreground">What you will learn</h2>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">{outcomes.map((outcome) => <li className="flex gap-2 text-sm text-muted-foreground" dir="auto" key={outcome}><CheckCircle aria-hidden="true" className="mt-0.5 shrink-0 text-academy-accent" size={16} weight="fill" />{outcome}</li>)}</ul>
            </section>
          ) : null}

          <section aria-labelledby="course-outline" className="py-6">
            <div className="flex items-end justify-between gap-4"><div><h2 className="text-sm font-medium text-foreground" id="course-outline">Course outline</h2><p className="mt-1 text-xs text-muted-foreground">{course.chapters.length} modules · {activities.length} lessons</p></div></div>
            <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
              {course.chapters.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted-foreground">No published modules yet.</p> : course.chapters.map((chapter, chapterIndex) => (
                <section className="border-b border-border last:border-b-0" key={chapter.chapter_uuid}>
                  <div className="flex items-center gap-3 bg-accent/50 px-4 py-3"><span className="text-xs font-medium text-academy-accent">{String(chapterIndex + 1).padStart(2, '0')}</span><h3 className="text-sm font-medium text-foreground" dir="auto">{chapter.name}</h3></div>
                  {chapter.activities.map((activity) => {
                    const activityId = stripPrefix(activity.activity_uuid, 'activity_')
                    const complete = completedIds.has(activityId) || completedIds.has(activity.activity_uuid)
                    return <Link className="group flex items-center gap-3 border-t border-border px-4 py-3 outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-academy-accent" href={getUriWithOrg(orgslug, `/course/${courseId}/activity/${activityId}`)} key={activity.activity_uuid}><span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground">{complete ? <CheckCircle aria-hidden="true" className="text-academy-accent" size={17} weight="fill" /> : <FileText aria-hidden="true" size={16} />}</span><span className="min-w-0 flex-1 text-sm text-foreground" dir="auto">{activity.name}</span><ArrowRight aria-hidden="true" className="text-muted-foreground group-hover:text-foreground" size={15} /></Link>
                  })}
                </section>
              ))}
            </div>
          </section>
        </div>

        <aside className="lg:pt-0">
          <div className="sticky top-24 rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">{activeRun ? <PlayCircle aria-hidden="true" className="text-academy-accent" size={19} weight="duotone" /> : <Lock aria-hidden="true" className="text-academy-accent" size={18} weight="duotone" />}{activeRun ? 'Continue learning' : 'Ready to begin?'}</div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{activeRun ? `${completedIds.size} of ${activities.length} lessons completed.` : 'Your progress is saved to your Trellis identity.'}</p>
            <button className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-academy-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" disabled={isStarting || !resumeActivity} onClick={beginCourse} type="button">{isStarting ? 'Opening…' : activeRun ? 'Resume course' : 'Start course'}<ArrowRight aria-hidden="true" size={16} /></button>
            {actionError ? <p className="mt-3 text-xs text-destructive" role="alert">{actionError}</p> : null}
          </div>
        </aside>
      </div>
    </main>
  )
}

function CourseSkeleton() {
  return <main aria-label="Loading course" className="mx-auto w-full max-w-6xl animate-pulse px-4 py-8 sm:px-6"><div className="h-4 w-20 rounded bg-accent" /><div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]"><div><div className="aspect-[16/7] rounded-lg bg-accent" /><div className="mt-6 h-8 w-2/3 rounded bg-accent" /><div className="mt-4 h-4 w-full rounded bg-accent" /></div><div className="h-48 rounded-lg bg-accent" /></div></main>
}

function CourseState({ title, description, orgslug }: { title: string; description: string; orgslug: string }) {
  return <main className="mx-auto flex min-h-[55vh] max-w-xl flex-col items-center justify-center px-6 text-center"><BookOpen aria-hidden="true" className="text-academy-accent" size={34} weight="duotone" /><h1 className="mt-4 text-xl font-medium text-foreground">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{description}</p><Link className="mt-6 inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent" href={getUriWithOrg(orgslug, '/courses')}>Back to courses</Link></main>
}

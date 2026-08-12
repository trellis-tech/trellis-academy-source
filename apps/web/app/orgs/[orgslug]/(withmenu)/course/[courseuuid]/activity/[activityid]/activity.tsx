'use client'

import { ArrowLeft, ArrowRight, BookOpen, CheckCircle, FileText, SpinnerGap, Trophy } from '@phosphor-icons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { lazy, Suspense, useState } from 'react'

import { queryKeys } from '@/lib/query/keys'
import { useCourseMeta } from '@/hooks/queries/useCourses'
import { useTrail } from '@/hooks/queries/useTrail'
import { AssignmentDirtyTasksProvider, useAssignmentDirtyTasks } from '@components/Contexts/Assignments/AssignmentDirtyTasksContext'
import { AssignmentProvider } from '@components/Contexts/Assignments/AssignmentContext'
import AssignmentSubmissionProvider, { useAssignmentSubmission } from '@components/Contexts/Assignments/AssignmentSubmissionContext'
import { AssignmentsTaskProvider } from '@components/Contexts/Assignments/AssignmentsTaskContext'
import { CourseProvider } from '@components/Contexts/CourseContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { markActivityAsComplete } from '@services/courses/activity'
import { getActivityWithAuthHeader } from '@services/courses/activities'
import { getAssignmentFromActivityUUID, getFinalGrade, submitAssignmentForGrading } from '@services/courses/assignments'

const AssignmentStudentActivity = lazy(() => import('@components/Objects/Activities/Assignment/AssignmentStudentActivity'))
const DocumentPdfActivity = lazy(() => import('@components/Objects/Activities/DocumentPdf/DocumentPdf'))
const EmbedActivity = lazy(() => import('@components/Objects/Activities/Embed/EmbedActivity'))
const MarkdownActivity = lazy(() => import('@components/Objects/Activities/Markdown/MarkdownActivity'))
const VideoActivity = lazy(() => import('@components/Objects/Activities/Video/Video'))

interface ActivityOutlineItem {
  id?: string | number
  activity_uuid: string
  name: string
  activity_type?: string
}

interface ChapterOutline {
  chapter_uuid: string
  name: string
  activities: ActivityOutlineItem[]
}

interface CourseOutline {
  course_uuid: string
  name: string
  chapters: ChapterOutline[]
}

interface ActivityView {
  activity_uuid: string
  name: string
  activity_type: string
  activity_sub_type?: string
  published: boolean
  is_locked: boolean
  content: Record<string, unknown>
  source: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function normalizeActivityItem(value: unknown): ActivityOutlineItem | null {
  if (!isRecord(value)) return null
  const activityUuid = text(value.activity_uuid)
  const name = text(value.name)
  if (!activityUuid || !name) return null
  return {
    id: typeof value.id === 'string' || typeof value.id === 'number' ? value.id : undefined,
    activity_uuid: activityUuid,
    name,
    activity_type: text(value.activity_type),
  }
}

function normalizeCourse(value: unknown): CourseOutline | null {
  if (!isRecord(value)) return null
  const courseUuid = text(value.course_uuid)
  const name = text(value.name)
  if (!courseUuid || !name) return null
  const chapters = Array.isArray(value.chapters) ? value.chapters.flatMap((chapter) => {
    if (!isRecord(chapter)) return []
    const chapterUuid = text(chapter.chapter_uuid)
    const chapterName = text(chapter.name)
    if (!chapterUuid || !chapterName) return []
    const activities = Array.isArray(chapter.activities)
      ? chapter.activities.map(normalizeActivityItem).filter((activity): activity is ActivityOutlineItem => activity !== null)
      : []
    return [{ chapter_uuid: chapterUuid, name: chapterName, activities }]
  }) : []
  return { course_uuid: courseUuid, name, chapters }
}

function normalizeActivity(value: unknown): ActivityView | null {
  if (!isRecord(value)) return null
  const activityUuid = text(value.activity_uuid)
  const name = text(value.name)
  const activityType = text(value.activity_type)
  if (!activityUuid || !name || !activityType) return null
  return {
    activity_uuid: activityUuid,
    name,
    activity_type: activityType,
    activity_sub_type: text(value.activity_sub_type),
    published: value.published === true,
    is_locked: value.is_locked === true,
    content: isRecord(value.content) ? value.content : {},
    source: value,
  }
}

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}

function assignmentFromResponse(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !isRecord(value.data)) return null
  return value.data
}

function submissionRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

export default function ActivityClient({ activityid, courseuuid, orgslug }: { activityid: string; courseuuid: string; orgslug: string }) {
  const session = useLHSession()
  const org = useOrg()
  const accessToken = session?.data?.tokens?.access_token
  const { data: courseData, isLoading: courseLoading } = useCourseMeta(courseuuid)
  const course = normalizeCourse(courseData)
  const isEnd = activityid === 'end'
  const { data: activityData, error: activityError, isLoading: activityLoading } = useQuery({
    queryKey: queryKeys.activity.detail(activityid),
    queryFn: () => getActivityWithAuthHeader(activityid, {}, accessToken),
    enabled: Boolean(activityid && accessToken && !isEnd),
    staleTime: 60_000,
  })
  const activity = normalizeActivity(activityData)
  const { data: trailData } = useTrail(typeof org?.id === 'number' ? org.id : undefined)

  if (courseLoading || activityLoading || session?.status === 'loading') return <ActivitySkeleton />
  if (!course) return <ActivityState orgslug={orgslug} title="Course unavailable" />
  if (isEnd) return <CourseCompletion course={course} orgslug={orgslug} trailData={trailData} />
  if (activityError || !activity || !activity.published) return <ActivityState orgslug={orgslug} title="Lesson unavailable" />
  if (activity.is_locked) return <ActivityState orgslug={orgslug} title="This lesson is locked" />

  const allActivities = course.chapters.flatMap((chapter) => chapter.activities.map((item) => ({ ...item, chapterName: chapter.name })))
  const index = allActivities.findIndex((item) => stripPrefix(item.activity_uuid, 'activity_') === stripPrefix(activityid, 'activity_'))
  const previous = index > 0 ? allActivities[index - 1] : null
  const next = index >= 0 && index < allActivities.length - 1 ? allActivities[index + 1] : null
  const current = index >= 0 ? allActivities[index] : null

  return (
    <CourseProvider courseuuid={course.course_uuid} initialCourseStructure={course}>
      <AssignmentDirtyTasksProvider>
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <Link className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-foreground hover:text-academy-accent" href={getUriWithOrg(orgslug, `/course/${stripPrefix(course.course_uuid, 'course_')}`)}><ArrowLeft aria-hidden="true" className="shrink-0" size={15} /><span className="truncate" dir="auto">{course.name}</span></Link>
          <span className="text-xs text-muted-foreground">Lesson {Math.max(index + 1, 1)} of {allActivities.length}</span>
        </div>

        <header className="py-6">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-academy-accent" dir="auto">{current?.chapterName ?? 'Course lesson'}</p>
          <h1 className="mt-2 text-2xl font-medium tracking-[-0.025em] text-foreground" dir="auto">{activity.name}</h1>
          <p className="mt-2 text-xs text-muted-foreground">{activityLabel(activity.activity_type, activity.activity_sub_type)}</p>
        </header>

        <section aria-label="Lesson content" className="overflow-hidden rounded-lg border border-border bg-card">
          <Suspense fallback={<ContentSkeleton />}>
            <ActivityContent accessToken={accessToken} activity={activity} course={course} orgslug={orgslug} />
          </Suspense>
        </section>

        <nav aria-label="Lesson navigation" className="mt-6 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          {previous ? <ActivityLink activity={previous} course={course} direction="previous" orgslug={orgslug} /> : <span />}
          {activity.activity_type === 'TYPE_ASSIGNMENT' ? null : <CompleteLessonButton activity={activity} course={course} next={next} orgslug={orgslug} />}
          {next ? <ActivityLink activity={next} course={course} direction="next" orgslug={orgslug} /> : null}
        </nav>
      </main>
      </AssignmentDirtyTasksProvider>
    </CourseProvider>
  )
}

function ActivityContent({ activity, course, orgslug, accessToken }: { activity: ActivityView; course: CourseOutline; orgslug: string; accessToken?: string }) {
  if (activity.activity_type === 'TYPE_ASSIGNMENT') {
    return <AssignmentExperience accessToken={accessToken} activity={activity} />
  }
  if (activity.activity_type === 'TYPE_DYNAMIC' && activity.activity_sub_type === 'SUBTYPE_DYNAMIC_MARKDOWN') return <MarkdownActivity activity={activity.source} />
  if (activity.activity_type === 'TYPE_DYNAMIC' && activity.activity_sub_type === 'SUBTYPE_DYNAMIC_EMBED') return <EmbedActivity activity={activity.source} />
  if (activity.activity_type === 'TYPE_VIDEO') return <VideoActivity activity={{
    activity_sub_type: activity.activity_sub_type ?? '',
    activity_uuid: activity.activity_uuid,
    content: {
      filename: text(activity.content.filename),
      uri: text(activity.content.uri),
    },
  }} course={course} />
  if (activity.activity_type === 'TYPE_DOCUMENT') return <DocumentPdfActivity activity={activity.source} course={course} className="h-[70vh] min-h-[32rem] w-full" />
  return <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center"><FileText aria-hidden="true" className="text-academy-accent" size={30} weight="duotone" /><p className="mt-3 text-sm text-muted-foreground">This lesson format is not available in Trellis Academy.</p><Link className="mt-4 text-xs font-medium text-foreground underline underline-offset-4" href={getUriWithOrg(orgslug, `/course/${stripPrefix(course.course_uuid, 'course_')}`)}>Back to course</Link></div>
}

function AssignmentExperience({ activity, accessToken }: { activity: ActivityView; accessToken?: string }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['academy', 'assignment', activity.activity_uuid],
    queryFn: () => {
      if (!accessToken) throw new Error('Academy session is unavailable')
      return getAssignmentFromActivityUUID(activity.activity_uuid, accessToken)
    },
    enabled: Boolean(accessToken),
    staleTime: 60_000,
  })
  const assignment = assignmentFromResponse(data)
  const assignmentUuid = assignment ? text(assignment.assignment_uuid) : undefined
  if (isLoading) return <ContentSkeleton />
  if (error || !assignmentUuid) return <div className="p-8 text-center text-sm text-muted-foreground">Assignment unavailable.</div>
  return (
    <AssignmentSubmissionProvider assignment_uuid={assignmentUuid}>
      <AssignmentProvider assignment_uuid={assignmentUuid}>
        <AssignmentsTaskProvider>
          <div className="p-4 sm:p-6"><AssignmentStudentActivity /><AssignmentStatus assignmentUuid={assignmentUuid} /></div>
        </AssignmentsTaskProvider>
      </AssignmentProvider>
    </AssignmentSubmissionProvider>
  )
}

function AssignmentStatus({ assignmentUuid }: { assignmentUuid: string }) {
  const session = useLHSession()
  const queryClient = useQueryClient()
  const dirtyTasks = useAssignmentDirtyTasks()
  const rows = submissionRows(useAssignmentSubmission())
  const status = text(rows[0]?.submission_status)
  const graded = status === 'GRADED'
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const userId = session?.data?.user?.id
  const accessToken = session?.data?.tokens?.access_token
  const { data: gradeResponse } = useQuery({
    queryKey: ['academy', 'grade', assignmentUuid, userId],
    queryFn: () => {
      if (!accessToken || (typeof userId !== 'string' && typeof userId !== 'number')) throw new Error('Academy session is unavailable')
      return getFinalGrade(String(userId), assignmentUuid, accessToken)
    },
    enabled: Boolean(graded && accessToken && (typeof userId === 'string' || typeof userId === 'number')),
  })
  const grade = isRecord(gradeResponse) && isRecord(gradeResponse.data) ? gradeResponse.data : null
  const displayGrade = grade ? text(grade.display_grade) ?? (typeof grade.grade === 'number' && typeof grade.max_grade === 'number' ? `${grade.grade}/${grade.max_grade}` : undefined) : undefined

  async function submit() {
    if (!accessToken || isSubmitting) return
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      if (!(await dirtyTasks.flushAll())) throw new Error('One or more answers could not be saved')
      const response = await submitAssignmentForGrading(assignmentUuid, accessToken)
      if (!response.success) throw new Error('The assignment was not accepted')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.assignments.submission(assignmentUuid) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.assignments.taskSubmission(assignmentUuid) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.assignments.tasks(assignmentUuid) }),
      ])
      setConfirmOpen(false)
    } catch (error) {
      console.error('Failed to submit Academy assignment', error)
      setSubmitError('Your answers could not be submitted. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
      <div>{graded ? <span className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-foreground"><CheckCircle aria-hidden="true" className="text-academy-accent" size={16} weight="fill" />Graded {displayGrade ? <span>{displayGrade}</span> : null}</span> : <span className="text-xs text-muted-foreground">Save each answer before submitting for grading.</span>}{submitError ? <p className="mt-2 text-xs text-destructive" role="alert">{submitError}</p> : null}</div>
      {!graded && !confirmOpen ? <button className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50" disabled={isSubmitting} onClick={() => setConfirmOpen(true)} type="button">{isSubmitting ? 'Submitting…' : 'Submit for grading'}</button> : null}
      {confirmOpen ? <div aria-labelledby="submit-assignment-title" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm" role="dialog"><div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg"><h2 className="text-lg font-medium text-foreground" id="submit-assignment-title">Submit assignment?</h2><p className="mt-2 text-sm text-muted-foreground">Your saved answers will be sent for grading.</p><div className="mt-6 flex justify-end gap-2"><button className="rounded-md border border-border px-3 py-2 text-sm" disabled={isSubmitting} onClick={() => setConfirmOpen(false)} type="button">Cancel</button><button className="inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50" disabled={isSubmitting} onClick={submit} type="button">{isSubmitting ? <SpinnerGap aria-hidden="true" className="animate-spin" size={15} /> : null}Submit Assignment</button></div></div></div> : null}
    </div>
  )
}

function CompleteLessonButton({ activity, course, next, orgslug }: { activity: ActivityView; course: CourseOutline; next: ActivityOutlineItem | null; orgslug: string }) {
  const session = useLHSession()
  const queryClient = useQueryClient()
  const org = useOrg()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const destination = next ? stripPrefix(next.activity_uuid, 'activity_') : 'end'
  async function complete() {
    const accessToken = session?.data?.tokens?.access_token
    if (!accessToken || pending) return
    setPending(true)
    setError(null)
    try {
      await markActivityAsComplete(orgslug, course.course_uuid, activity.activity_uuid, accessToken)
      if (typeof org?.id === 'number') await queryClient.invalidateQueries({ queryKey: queryKeys.trail.org(org.id) })
      window.location.assign(getUriWithOrg(orgslug, `/course/${stripPrefix(course.course_uuid, 'course_')}/activity/${destination}`))
    } catch (completeError) {
      console.error('Failed to complete Academy lesson', completeError)
      setError('Progress could not be saved.')
    } finally {
      setPending(false)
    }
  }
  return <div className="text-center"><button className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50" disabled={pending} onClick={complete} type="button">{pending ? 'Saving…' : next ? 'Complete and continue' : 'Complete course'}<CheckCircle aria-hidden="true" size={16} /></button>{error ? <p className="mt-2 text-xs text-destructive" role="alert">{error}</p> : null}</div>
}

function ActivityLink({ activity, course, orgslug, direction }: { activity: ActivityOutlineItem; course: CourseOutline; orgslug: string; direction: 'previous' | 'next' }) {
  const href = getUriWithOrg(orgslug, `/course/${stripPrefix(course.course_uuid, 'course_')}/activity/${stripPrefix(activity.activity_uuid, 'activity_')}`)
  return <Link className="inline-flex max-w-60 items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground" href={href}>{direction === 'previous' ? <ArrowLeft aria-hidden="true" size={14} /> : null}<span className="truncate" dir="auto">{activity.name}</span>{direction === 'next' ? <ArrowRight aria-hidden="true" size={14} /> : null}</Link>
}

function CourseCompletion({ course, orgslug, trailData }: { course: CourseOutline; orgslug: string; trailData: unknown }) {
  const runCount = isRecord(trailData) && Array.isArray(trailData.runs) ? trailData.runs.length : 0
  return <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-6 text-center"><Trophy aria-hidden="true" className="text-academy-accent" size={42} weight="duotone" /><p className="mt-4 text-xs font-medium uppercase tracking-[0.14em] text-academy-accent">Course complete</p><h1 className="mt-2 text-2xl font-medium text-foreground" dir="auto">{course.name}</h1><p className="mt-3 text-sm text-muted-foreground">Your progress is saved{runCount > 0 ? ' to your learning record' : ''}.</p><div className="mt-6 flex flex-wrap justify-center gap-2"><Link className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background" href={getUriWithOrg(orgslug, '/trail')}>View progress</Link><Link className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground" href={getUriWithOrg(orgslug, '/courses')}>Back to courses</Link></div></main>
}

function activityLabel(type: string, subtype?: string): string {
  if (type === 'TYPE_ASSIGNMENT') return 'Assignment'
  if (type === 'TYPE_VIDEO') return 'Video lesson'
  if (type === 'TYPE_DOCUMENT') return 'Document'
  if (subtype === 'SUBTYPE_DYNAMIC_MARKDOWN') return 'Reading'
  if (subtype === 'SUBTYPE_DYNAMIC_EMBED') return 'Interactive lesson'
  return 'Lesson'
}

function ActivitySkeleton() {
  return <main aria-label="Loading lesson" className="mx-auto w-full max-w-6xl animate-pulse px-4 py-8 sm:px-6"><div className="h-5 w-48 rounded bg-accent" /><div className="mt-8 h-7 w-2/3 rounded bg-accent" /><div className="mt-6 h-[32rem] rounded-lg bg-accent" /></main>
}

function ContentSkeleton() {
  return <div className="min-h-80 animate-pulse space-y-4 p-6"><div className="h-6 w-2/5 rounded bg-accent" /><div className="h-4 w-full rounded bg-accent" /><div className="h-4 w-5/6 rounded bg-accent" /></div>
}

function ActivityState({ title, orgslug }: { title: string; orgslug: string }) {
  return <main className="mx-auto flex min-h-[55vh] max-w-xl flex-col items-center justify-center px-6 text-center"><BookOpen aria-hidden="true" className="text-academy-accent" size={34} weight="duotone" /><h1 className="mt-4 text-xl font-medium text-foreground">{title}</h1><Link className="mt-6 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground" href={getUriWithOrg(orgslug, '/courses')}>Back to courses</Link></main>
}

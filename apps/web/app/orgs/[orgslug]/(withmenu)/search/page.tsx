'use client'

import { Folder, MagnifyingGlass } from '@phosphor-icons/react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent, useEffect, useState } from 'react'

import AcademyCourseCard, { type AcademyCourseSummary } from '@components/Academy/AcademyCourseCard'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { searchOrgContent } from '@services/search/search'

interface AcademyFolderSummary {
  folder_uuid: string
  name: string
  description?: string | null
}

interface AcademySearchResults {
  courses: AcademyCourseSummary[]
  folders: AcademyFolderSummary[]
  total_courses: number
  total_folders: number
}

const EMPTY_RESULTS: AcademySearchResults = {
  courses: [],
  folders: [],
  total_courses: 0,
  total_folders: 0,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isCourse(value: unknown): value is AcademyCourseSummary {
  return isRecord(value)
    && typeof value.course_uuid === 'string'
    && typeof value.name === 'string'
}

function isFolder(value: unknown): value is AcademyFolderSummary {
  return isRecord(value)
    && typeof value.folder_uuid === 'string'
    && typeof value.name === 'string'
}

function parseResults(value: unknown): AcademySearchResults {
  if (!isRecord(value)) return EMPTY_RESULTS
  const courses = Array.isArray(value.courses) ? value.courses.filter(isCourse) : []
  const folders = Array.isArray(value.folders) ? value.folders.filter(isFolder) : []
  return {
    courses,
    folders,
    total_courses: typeof value.total_courses === 'number' ? value.total_courses : courses.length,
    total_folders: typeof value.total_folders === 'number' ? value.total_folders : folders.length,
  }
}

export default function SearchPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const org = useOrg()
  const session = useLHSession()
  const query = searchParams.get('q')?.trim() ?? ''
  const [input, setInput] = useState(query)
  const [results, setResults] = useState(EMPTY_RESULTS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setInput(query)
  }, [query])

  useEffect(() => {
    if (query.length < 3 || !org?.slug) {
      setResults(EMPTY_RESULTS)
      setError(null)
      return
    }

    let active = true
    setLoading(true)
    setError(null)
    searchOrgContent(org.slug, query, 1, 24, null, session?.data?.tokens?.access_token)
      .then((response) => {
        if (!active) return
        const payload = isRecord(response) && 'data' in response ? response.data : response
        setResults(parseResults(payload))
      })
      .catch((requestError: unknown) => {
        // eslint-disable-next-line no-console -- search failures must remain observable
        console.error('Academy search failed', requestError)
        if (active) {
          setResults(EMPTY_RESULTS)
          setError('Search is temporarily unavailable. Please try again.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [org?.slug, query, session?.data?.tokens?.access_token])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = input.trim()
    if (normalized.length < 3) {
      setError('Enter at least three characters.')
      return
    }
    router.push(`?q=${encodeURIComponent(normalized)}`)
  }

  const total = results.total_courses + results.total_folders

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <header className="border-b border-border pb-6">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-academy-accent">Academy index</p>
        <h1 className="mt-2 text-2xl font-medium tracking-[-0.02em] text-foreground">Search</h1>
        <p className="mt-2 text-sm text-muted-foreground">Find published courses and curriculum folders.</p>
        <form className="relative mt-5 max-w-2xl" onSubmit={submit}>
          <MagnifyingGlass aria-hidden="true" className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={17} />
          <input
            aria-describedby="academy-search-help"
            aria-label="Search Academy"
            className="h-10 w-full rounded-md border border-border bg-card ps-10 pe-24 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-academy-accent"
            onChange={(event) => setInput(event.target.value)}
            placeholder="Search courses and folders"
            type="search"
            value={input}
          />
          <button className="absolute end-1 top-1 flex h-8 items-center rounded-md bg-foreground px-3 text-xs font-medium text-background" type="submit">
            Search
          </button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground" id="academy-search-help">Use at least three characters.</p>
      </header>

      <div aria-live="polite" className="py-6">
        {error ? (
          <p className="rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>
        ) : null}
        {!query ? (
          <EmptySearch message="Enter a title or keyword to search the Academy." />
        ) : loading ? (
          <div aria-label="Searching Academy" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => <div className="h-48 animate-pulse rounded-lg border border-border bg-card" key={index} />)}
          </div>
        ) : total === 0 && !error ? (
          <EmptySearch message={`No Academy results for “${query}”.`} />
        ) : (
          <div className="space-y-8">
            <p className="text-xs text-muted-foreground">{total} result{total === 1 ? '' : 's'} for “{query}”</p>
            {results.courses.length > 0 ? (
              <section aria-labelledby="course-results">
                <h2 className="mb-3 text-sm font-medium text-foreground" id="course-results">Courses</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {results.courses.map((course) => (
                    <AcademyCourseCard course={course} key={course.course_uuid} orgUuid={org?.org_uuid} orgslug={org?.slug ?? ''} />
                  ))}
                </div>
              </section>
            ) : null}
            {results.folders.length > 0 ? (
              <section aria-labelledby="folder-results">
                <h2 className="mb-3 text-sm font-medium text-foreground" id="folder-results">Folders</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {results.folders.map((folder) => (
                    <Link className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 outline-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-academy-accent" href={getUriWithOrg(org?.slug ?? '', `/library/folder/${folder.folder_uuid.replace('folder_', '')}`)} key={folder.folder_uuid}>
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-academy-accent"><Folder aria-hidden="true" size={17} weight="duotone" /></span>
                      <span className="min-w-0"><span className="block text-sm font-medium text-foreground" dir="auto">{folder.name}</span>{folder.description ? <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground" dir="auto">{folder.description}</span> : null}</span>
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptySearch({ message }: { message: string }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 text-center">
      <MagnifyingGlass aria-hidden="true" className="text-academy-accent" size={28} />
      <p className="mt-3 text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

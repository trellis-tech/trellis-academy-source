'use client'

import { ArrowLeft, FolderSimple } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

import { queryKeys } from '@/lib/query/keys'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { getFolderById } from '@services/folders/folders'
import { FolderCard, LibraryItemCard, normalizeCourseItem, normalizeFolder } from '../../library-cards'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

export default function FolderClient({ orgslug, folderid }: { orgslug: string; folderid: string }) {
  const session = useLHSession()
  const org = useOrg()
  const accessToken = session?.data?.tokens?.access_token
  const folderUuid = `folder_${folderid}`
  const { data, error, isLoading } = useQuery({
    queryKey: queryKeys.folders.detail(folderUuid),
    queryFn: () => getFolderById(folderUuid, accessToken),
    enabled: Boolean(folderid && accessToken),
  })
  const folder = isRecord(data) ? data : null
  const name = folder && typeof folder.name === 'string' ? folder.name : 'Collection'
  const description = folder && typeof folder.description === 'string' ? folder.description : null
  const subfolders = folder && Array.isArray(folder.subfolders) ? folder.subfolders.map(normalizeFolder).filter((item) => item !== null) : []
  const courses = folder && Array.isArray(folder.items) ? folder.items.map(normalizeCourseItem).filter((item) => item !== null) : []

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <Link className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground" href={getUriWithOrg(orgslug, '/library')}><ArrowLeft aria-hidden="true" size={14} />Library</Link>
      <header className="mt-6 border-b border-border pb-6"><p className="text-xs font-medium uppercase tracking-[0.14em] text-academy-accent">Course collection</p><h1 className="mt-2 text-2xl font-medium tracking-[-0.02em] text-foreground" dir="auto">{name}</h1>{description ? <p className="mt-2 max-w-2xl text-sm text-muted-foreground" dir="auto">{description}</p> : null}</header>
      {isLoading || session?.status === 'loading' ? <FolderSkeleton /> : error || !folder ? <FolderState message="This collection is unavailable." /> : subfolders.length === 0 && courses.length === 0 ? <FolderState message="This collection does not contain published courses yet." /> : <div className="space-y-8 py-6">{subfolders.length > 0 ? <section aria-labelledby="nested-collections"><h2 className="mb-3 text-sm font-medium text-foreground" id="nested-collections">Collections</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{subfolders.map((subfolder) => <FolderCard folder={subfolder} key={subfolder.folder_uuid} orgslug={orgslug} />)}</div></section> : null}{courses.length > 0 ? <section aria-labelledby="collection-courses"><h2 className="mb-3 text-sm font-medium text-foreground" id="collection-courses">Courses</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{courses.map((course) => <LibraryItemCard item={course} key={course.resource_uuid} orgslug={orgslug} orgUuid={typeof org?.org_uuid === 'string' ? org.org_uuid : undefined} />)}</div></section> : null}</div>}
    </main>
  )
}

function FolderSkeleton() {
  return <div className="grid animate-pulse gap-4 py-6 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <div className="h-32 rounded-lg border border-border bg-card" key={index} />)}</div>
}

function FolderState({ message }: { message: string }) {
  return <div className="mt-6 flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 text-center"><FolderSimple aria-hidden="true" className="text-academy-accent" size={30} weight="duotone" /><p className="mt-3 text-sm text-muted-foreground">{message}</p></div>
}

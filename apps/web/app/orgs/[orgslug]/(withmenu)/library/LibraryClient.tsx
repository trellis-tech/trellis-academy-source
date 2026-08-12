'use client'

import { FolderSimple } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query/keys'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getOrgFolders, getOrgRootItems } from '@services/folders/folders'
import { FolderCard, LibraryItemCard, normalizeCourseItem, normalizeFolder } from './library-cards'

export default function LibraryClient({ orgslug }: { orgslug: string }) {
  const org = useOrg()
  const session = useLHSession()
  const accessToken = session?.data?.tokens?.access_token
  const orgId = typeof org?.id === 'number' ? org.id : undefined
  const { data: folderData, error: folderError, isLoading: foldersLoading } = useQuery({
    queryKey: orgId ? queryKeys.folders.list(orgId) : ['academy-folders', 'pending'],
    queryFn: () => {
      if (!orgId) throw new Error('Academy organization is unavailable')
      return getOrgFolders(orgId, accessToken)
    },
    enabled: Boolean(orgId && accessToken),
  })
  const { data: rootData, error: rootError, isLoading: rootLoading } = useQuery({
    queryKey: orgId ? ['academy-root-courses', orgId] : ['academy-root-courses', 'pending'],
    queryFn: () => {
      if (!orgId) throw new Error('Academy organization is unavailable')
      return getOrgRootItems(orgId, accessToken)
    },
    enabled: Boolean(orgId && accessToken),
  })
  const folders = Array.isArray(folderData) ? folderData.map(normalizeFolder).filter((folder) => folder !== null) : []
  const courses = Array.isArray(rootData) ? rootData.map(normalizeCourseItem).filter((course) => course !== null) : []
  const isLoading = foldersLoading || rootLoading || session?.status === 'loading'

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <header className="border-b border-border pb-6"><p className="text-xs font-medium uppercase tracking-[0.14em] text-academy-accent">Curriculum</p><h1 className="mt-2 text-2xl font-medium tracking-[-0.02em] text-foreground">Library</h1><p className="mt-2 text-sm text-muted-foreground">Browse published course collections.</p></header>
      {isLoading ? <LibrarySkeleton /> : folderError || rootError ? <LibraryState message="The library is temporarily unavailable. Please refresh and try again." /> : folders.length === 0 && courses.length === 0 ? <LibraryState message="Published course collections will appear here." /> : <div className="space-y-8 py-6">{folders.length > 0 ? <section aria-labelledby="collections"><h2 className="mb-3 text-sm font-medium text-foreground" id="collections">Collections</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{folders.map((folder) => <FolderCard folder={folder} key={folder.folder_uuid} orgslug={orgslug} />)}</div></section> : null}{courses.length > 0 ? <section aria-labelledby="library-courses"><h2 className="mb-3 text-sm font-medium text-foreground" id="library-courses">Courses</h2><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{courses.map((course) => <LibraryItemCard item={course} key={course.resource_uuid} orgslug={orgslug} orgUuid={typeof org?.org_uuid === 'string' ? org.org_uuid : undefined} />)}</div></section> : null}</div>}
    </main>
  )
}

function LibrarySkeleton() {
  return <div className="grid animate-pulse gap-4 py-6 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div className="h-32 rounded-lg border border-border bg-card" key={index} />)}</div>
}

function LibraryState({ message }: { message: string }) {
  return <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 text-center"><FolderSimple aria-hidden="true" className="text-academy-accent" size={30} weight="duotone" /><p className="mt-3 text-sm text-muted-foreground">{message}</p></div>
}

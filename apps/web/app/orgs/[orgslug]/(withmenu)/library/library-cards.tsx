import { ArrowRight, FolderSimple } from '@phosphor-icons/react'
import Link from 'next/link'

import AcademyCourseCard, { type AcademyCourseSummary } from '@components/Academy/AcademyCourseCard'
import { getUriWithOrg } from '@services/config/config'
import { removeFolderPrefix } from '@services/folders/folders'

export interface AcademyFolderSummary {
  folder_uuid: string
  name: string
  description?: string | null
  total_items?: number
}

interface AcademyLibraryItem {
  resource_type: 'courses'
  resource_uuid: string
  resource: AcademyCourseSummary
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

export function normalizeFolder(value: unknown): AcademyFolderSummary | null {
  if (!isRecord(value) || typeof value.folder_uuid !== 'string' || typeof value.name !== 'string') return null
  return {
    folder_uuid: value.folder_uuid,
    name: value.name,
    description: typeof value.description === 'string' ? value.description : null,
    total_items: typeof value.total_items === 'number' ? value.total_items : undefined,
  }
}

export function normalizeCourseItem(value: unknown): AcademyLibraryItem | null {
  if (!isRecord(value) || value.resource_type !== 'courses' || typeof value.resource_uuid !== 'string' || !isRecord(value.resource)) return null
  const resource = value.resource
  if (typeof resource.course_uuid !== 'string' || typeof resource.name !== 'string') return null
  return {
    resource_type: 'courses',
    resource_uuid: value.resource_uuid,
    resource: {
      course_uuid: resource.course_uuid,
      name: resource.name,
      description: typeof resource.description === 'string' ? resource.description : null,
      thumbnail_image: typeof resource.thumbnail_image === 'string' ? resource.thumbnail_image : null,
    },
  }
}

export function FolderCard({ folder, orgslug }: { folder: AcademyFolderSummary; orgslug: string }) {
  return (
    <Link className="group flex min-h-28 flex-col justify-between rounded-lg border border-border bg-card p-4 outline-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-academy-accent" href={getUriWithOrg(orgslug, `/library/folder/${removeFolderPrefix(folder.folder_uuid)}`)}>
      <span className="flex size-9 items-center justify-center rounded-md bg-accent text-academy-accent"><FolderSimple aria-hidden="true" size={19} weight="duotone" /></span>
      <span className="mt-5 flex items-end justify-between gap-3"><span className="min-w-0"><span className="block truncate text-sm font-medium text-foreground" dir="auto">{folder.name}</span>{folder.description ? <span className="mt-1 block line-clamp-1 text-xs text-muted-foreground" dir="auto">{folder.description}</span> : null}</span><ArrowRight aria-hidden="true" className="shrink-0 text-muted-foreground group-hover:text-foreground" size={14} /></span>
    </Link>
  )
}

export function LibraryItemCard({ item, orgslug, orgUuid }: { item: AcademyLibraryItem; orgslug: string; orgUuid?: string }) {
  return <AcademyCourseCard course={item.resource} orgslug={orgslug} orgUuid={orgUuid} />
}

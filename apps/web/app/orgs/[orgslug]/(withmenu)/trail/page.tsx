import React from 'react'
import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getAcademyServerSession, hasAcademyRefreshSession } from '@/lib/auth/server'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import Trail from './trail'

export const dynamic = 'force-dynamic'

type MetadataProps = {
  params: Promise<{ orgslug: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params;
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })
  return {
    title: 'Trail — ' + org.name,
    description:
      'Check your progress using trail and easily navigate through your courses.',
  }
}

const TrailPage = async (params: any) => {
  let orgslug = (await params.params).orgslug
  const session = await getAcademyServerSession()
  if (!session) {
    if (await hasAcademyRefreshSession()) {
      redirect('/api/auth/refresh?destination=%2Ftrail')
    }
    redirect('/login?next=%2Ftrail')
  }

  return (
    <div>
      <Trail orgslug={orgslug} />
    </div>
  )
}

export default TrailPage

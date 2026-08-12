'use client'

import LandingClassic from '@components/Landings/LandingClassic'
import { useCourses } from '@/hooks/queries/useCourses'
import { useOrg } from '@components/Contexts/OrgContext'

export default function HomeClient({ orgslug }: { orgslug: string }) {
  const org = useOrg()
  const { data: courses, isLoading } = useCourses(orgslug)

  if (!org || isLoading) {
    return (
      <div aria-label="Loading Academy" className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-8 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 lg:py-10">
        {Array.from({ length: 3 }, (_, index) => (
          <div className="h-64 animate-pulse rounded-lg border border-border bg-card" key={index} />
        ))}
      </div>
    )
  }

  return <LandingClassic courses={courses} orgslug={orgslug} orgUuid={org.org_uuid} />
}

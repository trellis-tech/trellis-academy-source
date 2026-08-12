'use client'

import { ArrowSquareOut, Certificate } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

import { queryKeys } from '@/lib/query/keys'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { getAllUserCertificates } from '@services/courses/certifications'
import { asArray } from '@services/utils/ts/requests'

interface CertificateSummary {
  certificate_user: {
    user_certification_uuid: string
    created_at: string
  }
  certification: {
    config: { certification_name: string }
  }
  course: { name: string }
}

function isCertificate(value: unknown): value is CertificateSummary {
  if (value === null || typeof value !== 'object') return false
  if (!('certificate_user' in value) || !('certification' in value) || !('course' in value)) return false
  const certificateUser = value.certificate_user
  const certification = value.certification
  const course = value.course
  return certificateUser !== null
    && typeof certificateUser === 'object'
    && 'user_certification_uuid' in certificateUser
    && typeof certificateUser.user_certification_uuid === 'string'
    && 'created_at' in certificateUser
    && typeof certificateUser.created_at === 'string'
    && certification !== null
    && typeof certification === 'object'
    && 'config' in certification
    && certification.config !== null
    && typeof certification.config === 'object'
    && 'certification_name' in certification.config
    && typeof certification.config.certification_name === 'string'
    && course !== null
    && typeof course === 'object'
    && 'name' in course
    && typeof course.name === 'string'
}

export default function UserCertificates({ orgslug }: { orgslug: string }) {
  const session = useLHSession()
  const org = useOrg()
  const accessToken = session?.data?.tokens?.access_token
  const { data, error, isLoading } = useQuery({
    queryKey: queryKeys.certifications.detail(`user_all_${org?.id}`),
    queryFn: () => {
      if (!org?.id || !accessToken) throw new Error('Academy session is unavailable')
      return getAllUserCertificates(org.id, accessToken)
    },
    select: (response: unknown) => asArray(response).filter(isCertificate),
    enabled: Boolean(accessToken && org?.id),
    staleTime: 60_000,
  })
  const certificates = data ?? []

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">Certificates</h2>
        {certificates.length > 0 ? <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-muted-foreground">{certificates.length}</span> : null}
      </div>
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">{Array.from({ length: 2 }, (_, index) => <div className="h-28 animate-pulse rounded-lg border border-border bg-card" key={index} />)}</div>
      ) : error ? (
        <CertificateState message="Certificates are temporarily unavailable." />
      ) : certificates.length === 0 ? (
        <CertificateState message="Completed certified courses will appear here." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {certificates.map((item) => {
            const href = getUriWithOrg(orgslug, `/certificates/${item.certificate_user.user_certification_uuid}/verify`)
            const awarded = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(item.certificate_user.created_at))
            return (
              <Link className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 outline-none hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-academy-accent" href={href} key={item.certificate_user.user_certification_uuid}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-academy-accent"><Certificate aria-hidden="true" size={19} weight="duotone" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-foreground" dir="auto">{item.certification.config.certification_name}</span><span className="mt-1 block text-xs text-muted-foreground" dir="auto">{item.course.name} · {awarded}</span></span>
                <ArrowSquareOut aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" size={15} />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CertificateState({ message }: { message: string }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 text-center">
      <Certificate aria-hidden="true" className="text-academy-accent" size={25} weight="duotone" />
      <p className="mt-3 text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

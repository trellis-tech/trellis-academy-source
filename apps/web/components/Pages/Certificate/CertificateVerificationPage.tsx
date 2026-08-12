'use client'

import { ArrowLeft, BookOpen, Certificate, CheckCircle, ShieldCheck, WarningCircle } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'

import { useOrg } from '@components/Contexts/OrgContext'
import { getUriWithOrg } from '@services/config/config'
import { getCertificateByUuid } from '@services/courses/certifications'

interface VerifiedCertificate {
  certificateId: string
  awardedAt: string
  certificationName: string
  certificationDescription?: string
  certificationType?: string
  instructor?: string
  courseUuid: string
  courseName: string
  recipient?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function normalizeCertificate(value: unknown): VerifiedCertificate | null {
  if (!isRecord(value) || !isRecord(value.data)) return null
  const data = value.data
  if (!isRecord(data.certificate_user) || !isRecord(data.certification) || !isRecord(data.course)) return null
  const certificateUser = data.certificate_user
  const certification = data.certification
  const course = data.course
  if (!isRecord(certification.config)) return null
  const config = certification.config
  const certificateId = text(certificateUser.user_certification_uuid)
  const awardedAt = text(certificateUser.created_at)
  const certificationName = text(config.certification_name)
  const courseUuid = text(course.course_uuid)
  const courseName = text(course.name)
  if (!certificateId || !awardedAt || !certificationName || !courseUuid || !courseName) return null
  const user = isRecord(data.user) ? data.user : isRecord(certificateUser.user) ? certificateUser.user : null
  const recipient = user
    ? [text(user.first_name), text(user.last_name)].filter(Boolean).join(' ') || text(user.username)
    : undefined
  return {
    certificateId,
    awardedAt,
    certificationName,
    certificationDescription: text(config.certification_description),
    certificationType: text(config.certification_type),
    instructor: text(config.certificate_instructor),
    courseUuid,
    courseName,
    recipient,
  }
}

export default function CertificateVerificationPage({ certificateUuid }: { certificateUuid: string }) {
  const org = useOrg()
  const orgId = typeof org?.id === 'number' ? org.id : undefined
  const orgslug = typeof org?.org_slug === 'string' ? org.org_slug : 'default'
  const { data, error, isLoading } = useQuery({
    queryKey: ['academy', 'certificate-verification', certificateUuid, orgId],
    queryFn: () => {
      if (!orgId) throw new Error('Academy organization is unavailable')
      return getCertificateByUuid(certificateUuid, orgId)
    },
    enabled: Boolean(orgId && certificateUuid),
    staleTime: 60_000,
  })
  const certificate = normalizeCertificate(data)

  if (isLoading || !orgId) return <VerificationLoading />
  if (error || !certificate) return <VerificationMissing certificateUuid={certificateUuid} orgslug={orgslug} />

  const awarded = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(certificate.awardedAt))
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <Link className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground" href={getUriWithOrg(orgslug, '/trail')}><ArrowLeft aria-hidden="true" size={14} />Progress</Link>
      <header className="mt-6 flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-medium uppercase tracking-[0.14em] text-academy-accent">Credential verification</p><h1 className="mt-2 text-2xl font-medium tracking-[-0.02em] text-foreground">Certificate verified</h1><p className="mt-2 text-sm text-muted-foreground">This credential matches a durable Trellis Academy learning record.</p></div><span className="inline-flex w-fit items-center gap-2 rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-foreground"><CheckCircle aria-hidden="true" className="text-academy-accent" size={16} weight="fill" />Verified</span></header>

      <div className="grid gap-6 py-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-labelledby="certificate-title" className="relative overflow-hidden rounded-lg border border-border bg-card p-8 sm:p-12">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-academy-accent" />
          <div className="flex items-center gap-2 text-academy-accent"><Certificate aria-hidden="true" size={26} weight="duotone" /><span className="text-xs font-medium uppercase tracking-[0.16em]">Trellis Academy</span></div>
          <p className="mt-12 text-xs uppercase tracking-[0.14em] text-muted-foreground">Certificate of completion</p>
          <h2 className="mt-3 text-3xl font-medium tracking-[-0.03em] text-foreground" dir="auto" id="certificate-title">{certificate.certificationName}</h2>
          {certificate.recipient ? <p className="mt-8 text-sm text-muted-foreground">Awarded to <span className="font-medium text-foreground" dir="auto">{certificate.recipient}</span></p> : null}
          <p className="mt-2 text-sm text-muted-foreground">For completing <span className="font-medium text-foreground" dir="auto">{certificate.courseName}</span> on {awarded}.</p>
          {certificate.certificationDescription ? <p className="mt-8 max-w-2xl border-t border-border pt-6 text-sm leading-6 text-muted-foreground" dir="auto">{certificate.certificationDescription}</p> : null}
          <div className="mt-10 flex flex-wrap items-end justify-between gap-6 border-t border-border pt-6"><div>{certificate.instructor ? <><p className="text-xs text-muted-foreground">Instructor</p><p className="mt-1 text-sm font-medium text-foreground" dir="auto">{certificate.instructor}</p></> : <><p className="text-xs text-muted-foreground">Issued by</p><p className="mt-1 text-sm font-medium text-foreground">Trellis Academy</p></>}</div><ShieldCheck aria-label="Verified credential" className="text-academy-accent" size={42} weight="duotone" /></div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-5"><h2 className="text-sm font-medium text-foreground">Credential details</h2><dl className="mt-4 space-y-4 text-xs"><div><dt className="text-muted-foreground">Certificate ID</dt><dd className="mt-1 break-all font-mono text-foreground">{certificate.certificateId}</dd></div><div><dt className="text-muted-foreground">Awarded</dt><dd className="mt-1 text-foreground">{awarded}</dd></div>{certificate.certificationType ? <div><dt className="text-muted-foreground">Type</dt><dd className="mt-1 text-foreground">{certificate.certificationType.replaceAll('_', ' ').toLowerCase()}</dd></div> : null}</dl></section>
          <Link className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 text-sm font-medium text-foreground hover:border-foreground/20" href={getUriWithOrg(orgslug, `/course/${certificate.courseUuid.replace('course_', '')}`)}><span className="flex items-center gap-2"><BookOpen aria-hidden="true" className="text-academy-accent" size={18} weight="duotone" />View course</span></Link>
        </aside>
      </div>
    </main>
  )
}

function VerificationLoading() {
  return <main aria-label="Verifying certificate" className="mx-auto w-full max-w-6xl animate-pulse px-4 py-10 sm:px-6"><div className="h-5 w-32 rounded bg-accent" /><div className="mt-6 h-[30rem] rounded-lg border border-border bg-card" /></main>
}

function VerificationMissing({ certificateUuid, orgslug }: { certificateUuid: string; orgslug: string }) {
  return <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-6 text-center"><WarningCircle aria-hidden="true" className="text-destructive" size={38} weight="duotone" /><h1 className="mt-4 text-xl font-medium text-foreground">Certificate not found</h1><p className="mt-2 text-sm text-muted-foreground">No active credential matches <span className="font-mono">{certificateUuid}</span>.</p><Link className="mt-6 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground" href={getUriWithOrg(orgslug, '/trail')}>Back to progress</Link></main>
}

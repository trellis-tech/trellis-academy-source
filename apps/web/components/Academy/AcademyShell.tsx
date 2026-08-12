'use client'

import type { ReactNode } from 'react'
import { Books, ChartLineUp, MagnifyingGlass, UserCircle } from '@phosphor-icons/react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { getUriWithOrg } from '@services/config/config'

const navigation = [
  { label: 'Courses', path: '/courses', Icon: Books },
  { label: 'Progress', path: '/trail', Icon: ChartLineUp },
  { label: 'Search', path: '/search', Icon: MagnifyingGlass },
]

export default function AcademyShell({
  children,
  orgslug,
}: {
  children: ReactNode
  orgslug: string
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const chromeless = searchParams.get('chrome') === 'none'

  if (chromeless) {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-sticky-header border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-4 px-4 sm:px-6">
          <Link
            className="flex min-h-10 shrink-0 items-center gap-2 rounded-md pe-2 font-medium outline-none transition-colors duration-150 hover:text-academy-accent focus-visible:ring-2 focus-visible:ring-academy-accent"
            href={getUriWithOrg(orgslug, '/courses')}
          >
            <span className="flex size-8 items-center justify-center rounded-md border border-border bg-card text-academy-accent">
              <Books aria-hidden="true" size={18} weight="duotone" />
            </span>
            <span className="hidden text-sm sm:inline">Trellis Academy</span>
            <span className="text-sm sm:hidden">Academy</span>
          </Link>

          <nav aria-label="Academy" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {navigation.map(({ label, path, Icon }) => {
              const href = getUriWithOrg(orgslug, path)
              const active = pathname === href || pathname.startsWith(`${href}/`)

              return (
                <Link
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-academy-accent ${
                    active
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                  href={href}
                  key={path}
                >
                  <Icon aria-hidden="true" size={17} weight={active ? 'fill' : 'regular'} />
                  <span className="hidden md:inline">{label}</span>
                </Link>
              )
            })}
          </nav>

          <Link
            aria-label="Account"
            className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-academy-accent"
            href={getUriWithOrg(orgslug, '/account')}
          >
            <UserCircle aria-hidden="true" size={20} />
          </Link>
        </div>
      </header>

      <main className="relative min-h-[calc(100vh-3.5rem)]">{children}</main>
    </div>
  )
}

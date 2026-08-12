'use client'

import { use, type ReactNode } from 'react'
import '@styles/globals.css'
import AcademyShell from '@components/Academy/AcademyShell'
import { SessionGate } from '@components/Contexts/LHSessionContext'

export default function RootLayout(props: {
  children: ReactNode
  params: Promise<{ orgslug: string }>
}) {
  const params = use(props.params)

  return (
    <SessionGate>
      <AcademyShell orgslug={params.orgslug}>{props.children}</AcademyShell>
    </SessionGate>
  )
}

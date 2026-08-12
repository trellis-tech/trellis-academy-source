import type React from 'react'
import type { Metadata } from 'next'
import { OrgProvider } from '@components/Contexts/OrgContext'
import OrgLanguageSync from '@components/Contexts/OrgLanguageSync'
import NextTopLoader from 'nextjs-toploader'
import Toast from '@components/Objects/StyledElements/Toast/Toast'
import '@styles/globals.css'

export const metadata: Metadata = {
  title: 'Trellis Academy',
  description: 'Training and learning for Trellis operators.',
}

export default async function RootLayout(props: {
  children: React.ReactNode
  params: Promise<{ orgslug: string }>
}) {
  const params = await props.params

  return (
    <OrgProvider orgslug={params.orgslug}>
      <OrgLanguageSync />
      <NextTopLoader
        color="hsl(var(--academy-accent))"
        initialPosition={0.3}
        height={2}
        easing="ease"
        speed={300}
        showSpinner={false}
      />
      <Toast />
      {props.children}
    </OrgProvider>
  )
}

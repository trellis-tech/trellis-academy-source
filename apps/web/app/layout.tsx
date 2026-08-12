import '../styles/globals.css'
import React from 'react'
import Providers from '@components/Providers'
import { Geist, Tajawal } from 'next/font/google'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Trellis Academy',
  description: 'Practical product training and operating guidance for teams using Trellis.',
  icons: { icon: '/icon.svg' },
  openGraph: {
    title: 'Trellis Academy',
    description: 'Practical product training and operating guidance for teams using Trellis.',
    type: 'website',
  },
}

const geist = Geist({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-default',
})

// Tajawal is the Arabic face for the whole product. It is FORCED whenever the
// UI is Arabic (see globals.css), not merely offered as a fallback: Tajawal
// ships a Latin subset too, so a mixed Arabic screen renders in one typeface
// instead of switching per glyph between two designs with different
// proportions.
const tajawal = Tajawal({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-arabic',
})

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // `dir` is deliberately absent from the <html> below. React only reconciles
  // attributes present in its virtual tree, so leaving it out means React never
  // clobbers what dir-init.js wrote before paint. `lang="en"` stays as the
  // no-JS baseline for crawlers; the script overwrites it for everyone else.
  return (
    <html
      className={`${geist.variable} ${tajawal.variable}`}
      lang="en"
      suppressHydrationWarning
    >
      <head>
        {/* Synchronous script — sets <html lang/dir> before body paints so an
            RTL locale never flashes an LTR layout. Must run first. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/dir-init.js" />
        {/* Synchronous script — blocks parsing to guarantee window.__RUNTIME_CONFIG__ exists before any JS runs.
            Next.js <Script strategy="beforeInteractive"> is not truly blocking in all browsers (Safari). */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/runtime-config.js" />
      </head>
      <body suppressHydrationWarning>
        <Providers>
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  )
}

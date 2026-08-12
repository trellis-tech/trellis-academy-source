export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
export async function GET() {
  return NextResponse.json(
    {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      revision: process.env.TRELLIS_ACADEMY_RELEASE_SHA || 'development',
      migrationHead: process.env.TRELLIS_ACADEMY_MIGRATION_HEAD || 'unknown',
    },
    { status: 200 }
  )
}

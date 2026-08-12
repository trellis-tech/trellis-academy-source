import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

import {
  ACADEMY_SSO_STATE_COOKIE,
  configuredHttpUrl,
  normalizeLearnerDestination,
} from '@services/auth/trellisLaunch'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const trellisUrl = configuredHttpUrl('TRELLIS_APP_URL')
  if (!trellisUrl) {
    return NextResponse.json({ error: 'Trellis SSO is not configured' }, { status: 503 })
  }

  const state = randomBytes(32).toString('base64url')
  const destination = normalizeLearnerDestination(request.nextUrl.searchParams.get('destination'))
  const startUrl = new URL('/api/academy/sso/start', trellisUrl)
  startUrl.searchParams.set('destination', destination)
  startUrl.searchParams.set('state', state)
  const response = NextResponse.redirect(startUrl)
  response.cookies.set(ACADEMY_SSO_STATE_COOKIE, state, {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/api/auth/trellis',
    maxAge: 5 * 60,
  })
  return response
}

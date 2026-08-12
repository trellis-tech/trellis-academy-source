import { NextRequest, NextResponse } from 'next/server'

import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  getCookieOptions,
} from '@services/auth/cookies'
import { configuredHttpUrl } from '@services/auth/trellisLaunch'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const trellisUrl = configuredHttpUrl('TRELLIS_APP_URL')
  if (!trellisUrl) return clearedResponse(request, 503)

  const apiUrl = configuredHttpUrl('NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL')
  if (apiUrl) {
    const cookie = [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]
      .flatMap((name) => {
        const value = request.cookies.get(name)?.value
        return value ? [`${name}=${value}`] : []
      })
      .join('; ')
    try {
      const revocation = await fetch(new URL('/api/v1/auth/trellis/logout', apiUrl), {
        method: 'DELETE',
        headers: cookie ? { Cookie: cookie } : undefined,
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
      })
      if (!revocation.ok) {
        console.warn(`[trellis-sso] Academy logout returned ${revocation.status}`)
      }
    } catch (error) {
      console.error('[trellis-sso] Academy session revocation failed', error)
    }
  }

  const logoutUrl = new URL('/api/academy/sso/logout', trellisUrl)
  const response = NextResponse.redirect(logoutUrl)
  clearAcademyCookies(response, request)
  return response
}

function clearedResponse(request: NextRequest, status: number): NextResponse {
  const response = NextResponse.json({ error: 'Trellis logout is not configured' }, { status })
  clearAcademyCookies(response, request)
  return response
}

function clearAcademyCookies(response: NextResponse, request: NextRequest): void {
  const options = getCookieOptions(request)
  for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, 'LH_session']) {
    response.cookies.set(name, '', { ...options, maxAge: 0 })
  }
}

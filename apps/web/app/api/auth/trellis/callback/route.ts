import { NextRequest, NextResponse } from 'next/server'

import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_MAX_AGE,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_MAX_AGE,
  getCookieOptions,
} from '@services/auth/cookies'
import {
  ACADEMY_SSO_STATE_COOKIE,
  configuredHttpUrl,
  normalizeLearnerDestination,
  secureEqual,
} from '@services/auth/trellisLaunch'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const suppliedState = request.nextUrl.searchParams.get('state') ?? ''
  const storedState = request.cookies.get(ACADEMY_SSO_STATE_COOKIE)?.value ?? ''
  const assertion = request.nextUrl.searchParams.get('assertion') ?? ''
  if (!suppliedState || !storedState || !assertion || !secureEqual(suppliedState, storedState)) {
    return withConsumedState(
      NextResponse.json({ error: 'Invalid or expired SSO state' }, { status: 400 }),
      request
    )
  }

  const apiUrl = configuredHttpUrl('NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL')
  if (!apiUrl) {
    return withConsumedState(
      NextResponse.json({ error: 'Academy API is not configured' }, { status: 503 }),
      request
    )
  }

  try {
    const exchangeUrl = new URL('/api/v1/auth/trellis/exchange', apiUrl)
    const exchange = await fetch(exchangeUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assertion }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    const payload: unknown = await exchange.json().catch(() => null)
    if (!exchange.ok || !payload || typeof payload !== 'object') {
      return withConsumedState(
        NextResponse.json(
          { error: 'Trellis SSO exchange failed' },
          { status: exchange.ok ? 502 : exchange.status }
        ),
        request
      )
    }
    const accessToken = Reflect.get(payload, 'access_token')
    const refreshToken = Reflect.get(payload, 'refresh_token')
    const destination = Reflect.get(payload, 'destination')
    if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
      return withConsumedState(
        NextResponse.json({ error: 'Trellis SSO exchange returned no session' }, { status: 502 }),
        request
      )
    }

    const redirect = NextResponse.redirect(
      new URL(normalizeLearnerDestination(typeof destination === 'string' ? destination : '/'), request.url),
      { headers: { 'Referrer-Policy': 'no-referrer' } }
    )
    const cookieOptions = getCookieOptions(request)
    redirect.cookies.set(ACCESS_TOKEN_COOKIE, accessToken, {
      ...cookieOptions,
      maxAge: ACCESS_TOKEN_MAX_AGE,
    })
    redirect.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, {
      ...cookieOptions,
      maxAge: REFRESH_TOKEN_MAX_AGE,
    })
    redirect.cookies.set('LH_session', '1', {
      ...cookieOptions,
      httpOnly: false,
      maxAge: REFRESH_TOKEN_MAX_AGE,
    })
    return withConsumedState(redirect, request)
  } catch (error) {
    console.error('[trellis-sso] Academy exchange failed', error)
    return withConsumedState(
      NextResponse.json({ error: 'Trellis SSO exchange failed' }, { status: 502 }),
      request
    )
  }
}

function withConsumedState(response: NextResponse, _request: NextRequest): NextResponse {
  response.cookies.set(ACADEMY_SSO_STATE_COOKIE, '', {
    httpOnly: true,
    secure: _request.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/api/auth/trellis',
    maxAge: 0,
  })
  return response
}

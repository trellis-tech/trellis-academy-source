import { NextRequest, NextResponse } from 'next/server'

import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_MAX_AGE,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_MAX_AGE,
  getCookieOptions,
} from '@services/auth/cookies'
import {
  configuredHttpUrl,
  normalizeLearnerDestination,
} from '@services/auth/trellisLaunch'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function handle(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname.replace('/api/auth/', '')
  if (path !== 'refresh') {
    return nativeAuthUnavailable()
  }

  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value
  if (!refreshToken) {
    return withClearedSession(
      NextResponse.json({ error: 'No refresh token' }, { status: 401 }),
      request
    )
  }

  const apiUrl = configuredHttpUrl('NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL')
  if (!apiUrl) {
    return NextResponse.json({ error: 'Academy API is not configured' }, { status: 503 })
  }

  let backendResponse: Response
  try {
    backendResponse = await fetch(
      new URL('/api/v1/auth/trellis/refresh', apiUrl).toString(),
      {
        method: 'POST',
        headers: { Cookie: `${REFRESH_TOKEN_COOKIE}=${refreshToken}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      }
    )
  } catch (error) {
    console.error('[trellis-sso] Academy refresh failed', error)
    return NextResponse.json({ error: 'Academy refresh failed' }, { status: 502 })
  }

  const payload: unknown = await backendResponse.json().catch(() => null)
  if (!backendResponse.ok) {
    const response = NextResponse.json(payload ?? { error: 'Academy refresh failed' }, {
      status: backendResponse.status,
    })
    return isTerminalAuthFailure(backendResponse.status)
      ? withClearedSession(response, request)
      : response
  }

  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Academy refresh returned no session' }, { status: 502 })
  }
  const accessToken = Reflect.get(payload, 'access_token')
  const rotatedRefreshToken = Reflect.get(payload, 'refresh_token')
  if (typeof accessToken !== 'string' || typeof rotatedRefreshToken !== 'string') {
    return NextResponse.json({ error: 'Academy refresh returned no session' }, { status: 502 })
  }

  const requestedDestination = request.nextUrl.searchParams.get('destination')
  const response = requestedDestination
    ? NextResponse.redirect(
        new URL(normalizeLearnerDestination(requestedDestination), request.url)
      )
    : NextResponse.json(payload)
  const cookieOptions = getCookieOptions(request)
  response.cookies.set(ACCESS_TOKEN_COOKIE, accessToken, {
    ...cookieOptions,
    maxAge: ACCESS_TOKEN_MAX_AGE,
  })
  response.cookies.set(REFRESH_TOKEN_COOKIE, rotatedRefreshToken, {
    ...cookieOptions,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  })
  response.cookies.set('LH_session', '1', {
    ...cookieOptions,
    httpOnly: false,
    maxAge: REFRESH_TOKEN_MAX_AGE,
  })
  return response
}

function nativeAuthUnavailable(): NextResponse {
  return NextResponse.json(
    { error: 'Native Academy authentication is unavailable' },
    { status: 410 }
  )
}

function isTerminalAuthFailure(status: number): boolean {
  return status === 401 || status === 403
}

function withClearedSession(response: NextResponse, request: NextRequest): NextResponse {
  const options = getCookieOptions(request)
  for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, 'LH_session']) {
    response.cookies.set(name, '', { ...options, maxAge: 0 })
  }
  return response
}

export async function GET(request: NextRequest) {
  return handle(request)
}

export async function POST() {
  return nativeAuthUnavailable()
}

export async function PUT() {
  return nativeAuthUnavailable()
}

export async function PATCH() {
  return nativeAuthUnavailable()
}

export async function DELETE() {
  return nativeAuthUnavailable()
}

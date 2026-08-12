import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { NextRequest } from 'next/server'

import {
  DEFAULT_LEARNER_DESTINATION,
  normalizeLearnerDestination,
  isExcludedAcademyPath,
  isNativeAcademyAuthPath,
} from '../services/auth/trellisLaunch'
import { GET as start } from '../app/api/auth/trellis/start/route'
import { GET as callback } from '../app/api/auth/trellis/callback/route'
import { GET as logout } from '../app/api/auth/trellis/logout/route'
import { GET as authProxyGet, POST as authProxyPost } from '../app/api/auth/[...path]/route'

const originalFetch = globalThis.fetch

describe('Trellis Academy web SSO boundary', () => {
  beforeEach(() => {
    process.env.TRELLIS_APP_URL = 'https://app.example.test'
    process.env.NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL = 'https://academy-api.example.test'
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    delete process.env.TRELLIS_APP_URL
    delete process.env.NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL
  })

  test('allows only Academy destinations', () => {
    expect(DEFAULT_LEARNER_DESTINATION).toBe('/courses')
    expect(normalizeLearnerDestination('/course/course_1/activity/2?attempt=1')).toBe(
      '/course/course_1/activity/2?attempt=1'
    )
    expect(normalizeLearnerDestination('/courses')).toBe('/courses')
    expect(normalizeLearnerDestination('/owner')).toBe('/owner')
    expect(normalizeLearnerDestination('/account/general')).toBe('/account/general')
    expect(normalizeLearnerDestination(null)).toBe('/courses')
    expect(normalizeLearnerDestination('/')).toBe('/courses')
    expect(normalizeLearnerDestination('https://evil.example/course/1')).toBe('/courses')
    expect(normalizeLearnerDestination('//evil.example/course/1')).toBe('/courses')
    expect(normalizeLearnerDestination('/\\evil.example/course/1')).toBe('/courses')
    expect(
      normalizeLearnerDestination('/course/course_1\r\nLocation: https://evil.example')
      ).toBe('/courses')
    expect(normalizeLearnerDestination('/auth/login')).toBe('/courses')
    expect(normalizeLearnerDestination('/admin/login')).toBe('/courses')
    expect(normalizeLearnerDestination('/communities')).toBe('/courses')
  })

  test('the proxy sends returning Trellis learners to the catalog', () => {
    const source = readFileSync(resolve(import.meta.dir, '../proxy.ts'), 'utf8')
    expect(source).toContain(
      "pathname === '/login' && hasSession"
    )
    expect(source).toContain(
      "NextResponse.redirect(new URL(DEFAULT_LEARNER_DESTINATION, req.url))"
    )
  })

  test('classifies every native browser auth surface as unavailable', () => {
    for (const path of [
      '/signup',
      '/forgot',
      '/reset',
      '/verify-email',
      '/auth/login',
      '/auth/signup',
      '/auth/callback/google',
      '/auth/sso/callback',
      '/auth/token-exchange',
      '/admin/login',
    ]) {
      expect(isNativeAcademyAuthPath(path)).toBe(true)
    }
    expect(isNativeAcademyAuthPath('/login')).toBe(false)
    expect(isNativeAcademyAuthPath('/course/course_1')).toBe(false)
  })

  test('classifies excluded AI, billing, social, and playground surfaces as unavailable', () => {
    for (const path of [
      '/ai',
      '/admin',
      '/billing',
      '/board/board_1',
      '/editor/course/course_1',
      '/payments/checkout',
      '/playgrounds',
      '/podcasts',
      '/store',
      '/communities',
      '/discussions/thread',
      '/api/billing/prices',
      '/account/profile',
      '/account/security',
      '/account/purchases',
    ]) {
      expect(isExcludedAcademyPath(path)).toBe(true)
    }
    expect(isExcludedAcademyPath('/courses')).toBe(false)
  })

  test('start creates a secure state cookie and redirects to the configured Trellis start', async () => {
    const response = await start(
      request('https://academy.example.test/api/auth/trellis/start?destination=%2Fcourse%2Fcourse_1')
    )
    const location = new URL(response.headers.get('location') ?? '')
    const state = location.searchParams.get('state')

    expect(location.origin).toBe('https://app.example.test')
    expect(location.pathname).toBe('/api/academy/sso/start')
    expect(location.searchParams.get('destination')).toBe('/course/course_1')
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(response.headers.get('set-cookie')).toContain('academy_sso_state=')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('set-cookie')).toContain('Secure')
    expect(response.headers.get('set-cookie')).toContain('SameSite=lax')
  })

  test('state cookies remain usable on the loopback HTTP E2E origin', async () => {
    const response = await start(
      request('http://127.0.0.1:3002/api/auth/trellis/start?destination=%2Fcourses')
    )

    expect(response.headers.get('set-cookie')).not.toContain('Secure')
  })

  test('callback consumes state, exchanges server-side, sets Academy cookies, and redirects safely', async () => {
    globalThis.fetch = mock(async () =>
      Response.json({
        access_token: 'academy-access',
        refresh_token: 'academy-refresh',
        destination: '/course/course_1',
      })
    )
    const response = await callback(
      request(
        'https://academy.example.test/api/auth/trellis/callback?assertion=one.two.three&state=matching-state',
        'academy_sso_state=matching-state'
      )
    )

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://academy-api.example.test/api/v1/auth/trellis/exchange',
      expect.objectContaining({ method: 'POST', cache: 'no-store' })
    )
    expect(response.headers.get('location')).toBe('https://academy.example.test/course/course_1')
    const cookies = response.headers.getSetCookie().join('\n')
    expect(cookies).toContain('LH_access=academy-access')
    expect(cookies).toContain('LH_refresh=academy-refresh')
    expect(cookies).toContain('LH_session=1')
    expect(cookies).toContain('academy_sso_state=')
    expect(cookies).toContain('Max-Age=0')
  })

  test('callback rejects mismatched state without contacting the API and consumes the cookie', async () => {
    globalThis.fetch = mock(async () => Response.json({}))
    const response = await callback(
      request(
        'https://academy.example.test/api/auth/trellis/callback?assertion=one.two.three&state=wrong',
        'academy_sso_state=expected'
      )
    )

    expect(response.status).toBe(400)
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(response.headers.getSetCookie().join('\n')).toContain('Max-Age=0')
  })

  test('logout clears Academy cookies before redirecting to the fixed Trellis logout', async () => {
    globalThis.fetch = mock(async () => Response.json({ ok: true }))
    const response = await logout(
      request(
        'https://academy.example.test/api/auth/trellis/logout?return_to=https://evil.example',
        'LH_access=access; LH_refresh=refresh; LH_session=1'
      )
    )

    expect(response.headers.get('location')).toBe(
      'https://app.example.test/api/academy/sso/logout'
    )
    const cookies = response.headers.getSetCookie().join('\n')
    expect(cookies).toContain('LH_access=')
    expect(cookies).toContain('LH_refresh=')
    expect(cookies).toContain('LH_session=')
  })

  test('same-origin refresh POSTs the refresh cookie to the Trellis-only API and rotates both cookies', async () => {
    globalThis.fetch = mock(async () =>
      Response.json({
        access_token: 'rotated-access',
        refresh_token: 'rotated-refresh',
        token_type: 'bearer',
      })
    )
    const response = await authProxyGet(
      request('https://academy.example.test/api/auth/refresh', 'LH_refresh=current-refresh')
    )

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://academy-api.example.test/api/v1/auth/trellis/refresh',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Cookie: 'LH_refresh=current-refresh' }),
      })
    )
    expect(response.status).toBe(200)
    const cookies = response.headers.getSetCookie().join('\n')
    expect(cookies).toContain('LH_access=rotated-access')
    expect(cookies).toContain('LH_refresh=rotated-refresh')
  })

  test('refresh redirects direct server navigation back to the allowlisted Academy page', async () => {
    globalThis.fetch = mock(async () => Response.json({
      access_token: 'rotated-access',
      refresh_token: 'rotated-refresh',
    }))
    const response = await authProxyGet(
      request(
        'https://academy.example.test/api/auth/refresh?destination=%2Fowner',
        'LH_refresh=current-refresh'
      )
    )
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://academy.example.test/owner')
  })

  test('terminal refresh rejection clears the Academy session', async () => {
    globalThis.fetch = mock(async () => Response.json({ detail: 'inactive' }, { status: 403 }))
    const response = await authProxyGet(
      request('https://academy.example.test/api/auth/refresh', 'LH_refresh=current-refresh')
    )

    expect(response.status).toBe(403)
    const cookies = response.headers.getSetCookie().join('\n')
    expect(cookies).toContain('LH_access=')
    expect(cookies).toContain('LH_refresh=')
    expect(cookies).toContain('LH_session=')
  })

  test('transient refresh failure preserves the Academy session for retry', async () => {
    globalThis.fetch = mock(async () => Response.json({ detail: 'retry' }, { status: 503 }))
    const response = await authProxyGet(
      request('https://academy.example.test/api/auth/refresh', 'LH_refresh=current-refresh')
    )

    expect(response.status).toBe(503)
    expect(response.headers.getSetCookie()).toHaveLength(0)
  })

  test('the generic native auth proxy is gone except for refresh', async () => {
    const response = await authProxyPost(
      request('https://academy.example.test/api/auth/login')
    )
    expect(response.status).toBe(410)
    const wrongMethod = await authProxyPost(
      request('https://academy.example.test/api/auth/refresh', 'LH_refresh=current-refresh')
    )
    expect(wrongMethod.status).toBe(410)
  })

  test('excluded server handlers are absent from the Academy build source', () => {
    for (const relativePath of [
      '../app/api/signup/route.ts',
      '../app/api/auth/google/authorize/route.ts',
      '../app/api/auth/google/token/route.ts',
      '../app/api/auth/token-exchange/route.ts',
      '../app/api/billing/webhook/route.ts',
      '../app/api/loops/admin/route.ts',
      '../app/api/podcast/[podcastuuid]/feed/route.ts',
      '../app/api/turnstile/verify/route.ts',
    ]) {
      expect(existsSync(resolve(import.meta.dir, relativePath))).toBe(false)
    }
  })

  test('the login page contains only Continue with Trellis authentication', () => {
    const source = readFileSync(resolve(import.meta.dir, '../app/auth/login/page.tsx'), 'utf8')
    expect(source).toContain('Continue with Trellis')
    expect(source).not.toContain('LoginClient')
    expect(source).not.toContain('password')
    expect(source).not.toContain('google')
    expect(source).not.toContain('signup')
  })

  test('course actions are unmetered and wait for the Trellis session', () => {
    for (const relativePath of [
      '../components/Objects/Courses/CourseActions/CoursesActions.tsx',
      '../components/Objects/Courses/CourseActions/CourseActionsMobile.tsx',
    ]) {
      const source = readFileSync(resolve(import.meta.dir, relativePath), 'utf8')
      expect(source).not.toContain('@services/payments')
      expect(source).not.toContain('getOffersByResource')
      expect(source).not.toContain("'/signup'")
      expect(source).toContain("session?.status === 'loading'")
    }
  })
})

function request(url, cookie) {
  return new NextRequest(url, { headers: cookie ? { cookie } : undefined })
}

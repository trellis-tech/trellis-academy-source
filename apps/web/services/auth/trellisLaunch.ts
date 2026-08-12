import { createHash, timingSafeEqual } from 'node:crypto'

const LEARNER_PATHS = [
  /^\/owner(?:\/|$)/,
  /^\/account(?:\/general)?(?:\/|$)/,
  /^\/courses(?:\/|$)/,
  /^\/course\/[^/]+(?:\/activity\/[^/]+)?(?:\/|$)/,
  /^\/trail(?:\/|$)/,
  /^\/library(?:\/|$)/,
  /^\/search(?:\/|$)/,
  /^\/certificates\/[^/]+\/verify(?:\/|$)/,
]

const NATIVE_AUTH_PATHS = new Set(['/signup', '/forgot', '/reset', '/verify-email'])
const NATIVE_AUTH_PREFIXES = [
  '/auth/login',
  '/auth/signup',
  '/auth/forgot',
  '/auth/reset',
  '/auth/verify-email',
  '/auth/magic',
  '/auth/callback/google',
  '/auth/sso',
  '/auth/token-exchange',
  '/admin/login',
]
const EXCLUDED_PRODUCT_PREFIXES = [
  '/admin',
  '/ai',
  '/billing',
  '/board',
  '/dash',
  '/editor',
  '/embed',
  '/home',
  '/new',
  '/organizations',
  '/payments',
  '/plans',
  '/playgrounds',
  '/podcast',
  '/podcasts',
  '/store',
  '/subscriptions',
  '/account/profile',
  '/account/security',
  '/account/purchases',
  '/user',
  '/communities',
  '/discussions',
  '/api/ai',
  '/api/billing',
  '/api/payments',
  '/api/playgrounds',
]

export const ACADEMY_SSO_STATE_COOKIE = 'academy_sso_state'
export const DEFAULT_LEARNER_DESTINATION = '/courses'

export function normalizeLearnerDestination(value: string | null | undefined): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    /[\r\n]/.test(value)
  )
    return DEFAULT_LEARNER_DESTINATION
  try {
    const parsed = new URL(value, 'https://academy.trellis.invalid')
    if (parsed.origin !== 'https://academy.trellis.invalid') return DEFAULT_LEARNER_DESTINATION
    if (!LEARNER_PATHS.some((pattern) => pattern.test(parsed.pathname)))
      return DEFAULT_LEARNER_DESTINATION
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return DEFAULT_LEARNER_DESTINATION
  }
}

export function isNativeAcademyAuthPath(pathname: string): boolean {
  return (
    NATIVE_AUTH_PATHS.has(pathname) ||
    NATIVE_AUTH_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
  )
}

export function isExcludedAcademyPath(pathname: string): boolean {
  return EXCLUDED_PRODUCT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

export function secureEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest()
  const rightDigest = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftDigest, rightDigest)
}

export function configuredHttpUrl(name: string): URL | null {
  const value = process.env[name]?.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

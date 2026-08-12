import {
  getDefaultOrg,
} from './services/config/config'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isLocalhost as isLocalhostCheck } from './services/utils/ts/hostUtils'
import {
  DEFAULT_LEARNER_DESTINATION,
  isExcludedAcademyPath,
  isNativeAcademyAuthPath,
} from './services/auth/trellisLaunch'

// =============================================================================
// Tenancy
// =============================================================================
//
// Three runtime behaviors selected by `instance.tenancy`:
//
//   1. multi (EE-only):   slug.{LEARNHOUSE_DOMAIN} subdomain detection +
//                         per-org custom domains. The detection logic lives in
//                         `./ee/services/tenancy/...` and is dynamic-imported
//                         here — OSS proxy.ts never references subdomain or
//                         custom-domain helpers directly.
//   2. single (localhost): always serves the default org. Host-only cookies.
//   3. single (VPS):       any domain on a self-hosted VPS. Same as #2 — we
//                         trust the incoming Host header.
//
// Modes 2 and 3 share `tenancy === "single"`. The OSS code path returns the
// default org without ever calling subdomain extraction.

interface InstanceInfo {
  multi_org_enabled: boolean
  default_org_slug: string
  mode: 'saas' | 'oss' | 'ee'
  tenancy: 'multi' | 'single'
  frontend_domain: string
  top_domain: string
}

function getInstanceInfo(req: NextRequest): InstanceInfo {
  return {
    multi_org_enabled: false,
    default_org_slug: getDefaultOrg(),
    mode: 'oss',
    tenancy: 'single',
    frontend_domain: req.nextUrl.host,
    top_domain: req.nextUrl.hostname,
  }
}

// =============================================================================
// Resolver
// =============================================================================

interface ResolvedTenant {
  slug: string
  customDomain?: string
  source: 'custom-domain' | 'subdomain' | 'cookie' | 'default'
}

/**
 * Resolve the active tenant for this request.
 *
 * In `single` tenancy this is unconditionally the default org — no EE code
 * loaded, no custom-domain lookup, no subdomain extraction. In `multi`
 * tenancy is unsupported by the community build, which falls back to the
 * configured default org.
 */
async function resolveTenant(req: NextRequest, instance: InstanceInfo): Promise<ResolvedTenant> {
  if (instance.tenancy === 'single') {
    return { slug: instance.default_org_slug, source: 'default' }
  }

  console.warn('[proxy] Multi tenancy is unavailable in the community build; using default org')
  return { slug: instance.default_org_slug, source: 'default' }
}

/**
 * In `multi` tenancy, ask the EE module whether this Host is a custom domain
 * (used by the `/redirect_from_auth` handler). Always false in `single`.
 */
async function hostIsCustomDomain(host: string | null, instance: InstanceInfo): Promise<boolean> {
  return false
}

/**
 * Detect the admin subdomain (multi tenancy only). In single mode there is no
 * admin subdomain — operators reach admin via /admin path.
 */
async function isAdminSubdomain(host: string | null, instance: InstanceInfo): Promise<boolean> {
  return false
}

// =============================================================================
// Cookies
// =============================================================================

/**
 * Compute the cookie `domain` attribute given the current tenant.
 * - single tenancy → '' (host-only cookie)
 * - multi tenancy + custom domain → '' (host-only cookie)
 * - multi tenancy + apex/subdomain → '.{top_domain}' (cross-subdomain auth)
 * - localhost in either mode → '' (browsers refuse `Domain=.localhost`)
 */
function cookieDomainFor(instance: InstanceInfo, customDomain?: string): string {
  if (instance.tenancy === 'single') return ''
  if (customDomain) return ''
  if (instance.top_domain === 'localhost') return ''
  return `.${instance.top_domain}`
}

function setOrgCookies(
  response: NextResponse,
  resolved: ResolvedTenant,
  instance: InstanceInfo,
) {
  const domain = cookieDomainFor(instance, resolved.customDomain)
  response.cookies.set({
    name: 'LH_org',
    value: resolved.slug,
    domain,
    path: '/',
  })
  if (resolved.customDomain) {
    response.cookies.set({
      name: 'LH_custom_domain',
      value: resolved.customDomain,
      path: '/',
    })
    response.headers.set('x-custom-domain', resolved.customDomain)
  }
}

function setInstanceCookies(response: NextResponse, info: InstanceInfo) {
  response.cookies.set({ name: 'LH_tenancy', value: info.tenancy, path: '/' })
  response.cookies.set({ name: 'LH_default_org', value: info.default_org_slug, path: '/' })
  response.cookies.set({ name: 'LH_frontend_domain', value: info.frontend_domain, path: '/' })
  response.cookies.set({ name: 'LH_top_domain', value: info.top_domain, path: '/' })
  response.cookies.set({ name: 'LH_mode', value: info.mode, path: '/' })
  return response
}

/**
 * Build a request-header bag that propagates tenancy context to downstream
 * Server Components on THIS request. Cookies set in the response only become
 * visible to RSC on the *next* request, so server-side helpers like
 * `getCanonicalUrl` can't rely on them on the first cold load. Reading the
 * `x-lh-*` headers via `next/headers` gives them an immediately-available
 * source of truth.
 */
function tenantRequestHeaders(
  req: NextRequest,
  resolved: ResolvedTenant,
  instance: InstanceInfo,
): Headers {
  const headers = new Headers(req.headers)
  headers.set('x-lh-tenancy', instance.tenancy)
  headers.set('x-lh-org', resolved.slug)
  headers.set('x-lh-top-domain', instance.top_domain)
  headers.set('x-lh-frontend-domain', instance.frontend_domain)
  headers.set('x-lh-mode', instance.mode)
  if (resolved.customDomain) {
    headers.set('x-lh-custom-domain', resolved.customDomain)
  }
  return headers
}

// =============================================================================
// Middleware
// =============================================================================

export const config = {
  matcher: [
    /*
     * Match all paths except for:
     * 1. /api routes
     * 2. /_next (Next.js internals)
     * 3. /fonts (inside /public)
     * 4. /examples (inside /public)
     * 5. all root files inside /public (e.g. /favicon.ico)
     */
    '/((?!api|_next|fonts|examples|monitoring|[\\w-]+\\.\\w+).*)',
    '/sitemap.xml',
    '/robots.txt',
    '/payments/stripe/connect/oauth',
    '/podcast/:path*/feed',
  ],
}

export default async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const fullhost = req.headers.get('host')

  if (isNativeAcademyAuthPath(pathname)) {
    return NextResponse.json({ error: 'Native Academy authentication is unavailable' }, { status: 410 })
  }
  if (isExcludedAcademyPath(pathname)) {
    return NextResponse.json({ error: 'Academy surface is unavailable' }, { status: 410 })
  }

  const instance = getInstanceInfo(req)

  // SEO: canonicalize mixed-case top-level route names (/Login → /login). Scoped
  // to KNOWN static routes only so it never lowercases data-bearing segments
  // (org slugs, course/activity UUIDs, media paths).
  const CANONICAL_LOWER = new Set([
    '/login', '/signup', '/forgot', '/reset', '/verify-email',
    '/home', '/billing', '/new', '/account', '/organizations', '/subscriptions',
  ])
  if (pathname !== pathname.toLowerCase() && CANONICAL_LOWER.has(pathname.toLowerCase())) {
    return NextResponse.redirect(new URL(`${pathname.toLowerCase()}${search}`, req.url), 308)
  }

  // -------------------------------------------------------------------------
  // 1. Admin subdomain (multi only) → rewrite to /admin route group.
  //    Idempotent: if the path already starts with /admin (e.g. internal nav
  //    uses /admin/organizations so it works in both subdomain and path mode),
  //    don't double-prefix.
  // -------------------------------------------------------------------------
  if (await isAdminSubdomain(fullhost, instance)) {
    const target = pathname === '/admin' || pathname.startsWith('/admin/')
      ? pathname
      : `/admin${pathname}`
    const response = NextResponse.rewrite(new URL(`${target}${search}`, req.url))
    setInstanceCookies(response, instance)
    return response
  }

  // -------------------------------------------------------------------------
  // 1b. Admin path — direct /admin access works in any tenancy mode.
  //     In single mode this is the only way to reach the admin panel; in
  //     multi mode it's an alternative to the admin.{domain} subdomain.
  // -------------------------------------------------------------------------
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    const response = NextResponse.rewrite(new URL(`${pathname}${search}`, req.url))
    setInstanceCookies(response, instance)
    return response
  }

  // -------------------------------------------------------------------------
  // 1b. Legacy /dashboard/* → hub redirects
  //
  //    The old platform (learnhouse.app) used /dashboard/{slug}/plan, /dashboard/
  //    new, /dashboard/account, etc. Those paths do NOT exist on .io and would
  //    404. Old bookmarks, emails, and — critically — URLs Stripe has already
  //    stored on live checkout sessions can still point here, so permanently map
  //    them onto the hub instead of dead-ending. SaaS/multi only.
  // -------------------------------------------------------------------------
  if (instance.tenancy === 'multi' && pathname.startsWith('/dashboard')) {
    let dest = '/home'
    const planMatch = pathname.match(/^\/dashboard\/([^/]+)\/plan\/?$/)
    if (planMatch && planMatch[1] !== 'new') {
      dest = `/billing?org=${planMatch[1]}`
    } else if (pathname === '/dashboard/new' || pathname.startsWith('/dashboard/new/')) {
      dest = '/new'
    } else if (pathname === '/dashboard/subscriptions') {
      dest = '/subscriptions'
    } else if (pathname === '/dashboard/account' || pathname.startsWith('/dashboard/account/')) {
      dest = '/account'
    }
    // Preserve query markers (checkout=cancelled, session_id, …). /billing?org=
    // already carries a query, so merge with & in that case.
    const extraQuery = search ? (dest.includes('?') ? `&${search.slice(1)}` : search) : ''
    return NextResponse.redirect(new URL(`${dest}${extraQuery}`, req.url), 308)
  }

  // -------------------------------------------------------------------------
  // 2. Standard out-of-org paths (root hub)
  //
  //    These render at the apex/root and must NEVER fall into the tenant
  //    catch-all (which would rewrite them to /orgs/{slug}/...). `/home` is the
  //    org picker and works in every tenancy. The rest form the central
  //    account + org-management hub (create / upgrade / delete an org, billing,
  //    account) and only exist in `multi` tenancy (SaaS); the (hub) route-group
  //    layout additionally enforces SaaS gating. We set instance cookies so the
  //    hub's client components can read tenancy/mode/top-domain.
  // -------------------------------------------------------------------------
  const HUB_ROOT_PATHS = ['/home', '/organizations', '/account', '/billing', '/subscriptions', '/new']
  const isHubRoot = HUB_ROOT_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
  if (pathname === '/home' || (instance.tenancy === 'multi' && isHubRoot)) {
    // `/account/*` ALSO exists as an org-scoped dashboard route
    // (/orgs/{slug}/account/[subpage] — general/security/purchases). On an org
    // subdomain or custom domain it must resolve there, NOT the apex hub (which
    // has no /account subpages), so let it fall through to the tenant catch-all.
    let onOrgHost = false
    if ((pathname === '/account' || pathname.startsWith('/account/')) && instance.tenancy === 'multi') {
      const resolved = await resolveTenant(req, instance)
      onOrgHost = resolved.source === 'subdomain' || resolved.source === 'custom-domain'
    }
    if (!onOrgHost) {
      const response = NextResponse.rewrite(new URL(`${pathname}${search}`, req.url))
      setInstanceCookies(response, instance)
      return response
    }
    // account on an org host → fall through to the tenant-scoped rewrite below.
  }

  // -------------------------------------------------------------------------
  // 3. Auth pages — resolve tenant for cookie context, rewrite to /auth
  // -------------------------------------------------------------------------
  const authPaths = ['/login', '/signup', '/reset', '/forgot', '/verify-email']
  if (authPaths.includes(pathname)) {
    const hasSession = !!req.cookies.get('LH_session')?.value

    // A logged-in learner has no business on /login. Academy has one fixed
    // organization, so send them to its catalog instead of the multi-org hub.
    if (pathname === '/login' && hasSession) {
      return NextResponse.redirect(new URL(DEFAULT_LEARNER_DESTINATION, req.url))
    }

    const resolved = await resolveTenant(req, instance)

    // `/signup` is NOT only a signup page: for a signed-in user on an org host
    // it is the JOIN screen (the "Join this organization" banner and every
    // invite link point at it). Bouncing them to /home dropped them on the org
    // picker instead — and silently threw away any ?inviteCode. So only send a
    // signed-in visitor to the hub when there is genuinely no org to join here:
    // the org-less apex, with no invite code in hand.
    if (pathname === '/signup' && hasSession) {
      const onOrgHost =
        instance.tenancy === 'single'
        || resolved.source === 'subdomain'
        || resolved.source === 'custom-domain'
      const hasInviteCode = !!req.nextUrl.searchParams.get('inviteCode')
      if (!onOrgHost && !hasInviteCode) {
        return NextResponse.redirect(new URL('/home', req.url))
      }
    }

    const requestHeaders = tenantRequestHeaders(req, resolved, instance)
    const response = NextResponse.rewrite(
      new URL(`/auth${pathname}${search}`, req.url),
      { request: { headers: requestHeaders } },
    )
    setOrgCookies(response, resolved, instance)
    setInstanceCookies(response, instance)
    return response
  }

  // -------------------------------------------------------------------------
  // 4. Auth callbacks — pass through without org rewrite
  // -------------------------------------------------------------------------
  if (
    pathname.startsWith('/auth/sso/')
    || pathname.startsWith('/auth/callback/')
    || pathname.startsWith('/auth/token-exchange')
  ) {
    const response = NextResponse.rewrite(new URL(`${pathname}${search}`, req.url))
    setInstanceCookies(response, instance)
    return response
  }

  // Magic login links are emailed as /auth/magic?token=… — already the internal
  // path, so it needs a pass-through of its own. Without one it fell to the
  // tenant catch-all, was rewritten to /orgs/{slug}/auth/magic, and every
  // emailed link 404'd. Tenant is resolved (unlike the callbacks above) because
  // the page finishes through /redirect_from_auth, which reads the org cookies
  // to know which host to land on.
  if (pathname === '/auth/magic') {
    const resolved = await resolveTenant(req, instance)
    const requestHeaders = tenantRequestHeaders(req, resolved, instance)
    const response = NextResponse.rewrite(
      new URL(`${pathname}${search}`, req.url),
      { request: { headers: requestHeaders } },
    )
    setOrgCookies(response, resolved, instance)
    setInstanceCookies(response, instance)
    return response
  }

  // -------------------------------------------------------------------------
  // 5. Standalone editors / boards — bypass org rewrite
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/course\/[^/]+\/activity\/[^/]+\/edit$/)) {
    return NextResponse.rewrite(new URL(`/editor${pathname}`, req.url))
  }
  if (pathname.startsWith('/board/')) {
    const response = NextResponse.rewrite(new URL(pathname + search, req.url))
    setInstanceCookies(response, instance)
    return response
  }
  if (pathname.startsWith('/editor/playground/')) {
    const response = NextResponse.rewrite(new URL(pathname + search, req.url))
    setInstanceCookies(response, instance)
    return response
  }

  // -------------------------------------------------------------------------
  // 6. Stripe Connect OAuth callback — preserve search params + add orgslug
  // -------------------------------------------------------------------------
  if (req.nextUrl.pathname.startsWith('/payments/stripe/connect/oauth')) {
    const searchParams = req.nextUrl.searchParams
    const orgslug = searchParams.get('state')?.split('_')[0]
    const redirectUrl = new URL('/payments/stripe/connect/oauth', req.url)
    searchParams.forEach((value, key) => {
      redirectUrl.searchParams.append(key, value)
    })
    if (orgslug) {
      redirectUrl.searchParams.set('orgslug', orgslug)
    }
    return NextResponse.rewrite(redirectUrl)
  }

  // -------------------------------------------------------------------------
  // 7. Health check
  // -------------------------------------------------------------------------
  if (pathname.startsWith('/health')) {
    return NextResponse.rewrite(new URL(`/api/health`, req.url))
  }

  // -------------------------------------------------------------------------
  // 8. Auth redirect bridge (cross-domain return path)
  // -------------------------------------------------------------------------
  if (pathname === '/redirect_from_auth') {
    const params = new URLSearchParams(req.nextUrl.searchParams)

    const rawNext = params.get('next')
    params.delete('next')

    const customDomain = req.cookies.get('LH_custom_domain')?.value
    const base = customDomain
      ? `${req.nextUrl.protocol}//${customDomain}`
      : req.url
    const baseOrigin = new URL(base).origin

    // Every auth flow forwards where the user was headed as ?next. Landing them
    // on "/" instead threw that away, so a deep link that prompted a sign-in
    // always returned to the org picker.
    //
    // Resolve the candidate and compare origins rather than pattern-matching the
    // raw string: this is an open-redirect sink, and a prefix test lets through
    // anything the URL parser later normalises into another origin ("//evil",
    // "/\evil", encoded control characters). Only the path survives.
    let dest = '/'
    if (rawNext) {
      try {
        const candidate = new URL(rawNext, baseOrigin)
        if (candidate.origin === baseOrigin) {
          dest = `${candidate.pathname}${candidate.search}${candidate.hash}`
        }
      } catch {
        // Unparseable — fall back to the root.
      }
    }

    const redirectUrl = new URL(dest, base)
    const remaining = params.toString()
    if (remaining) {
      redirectUrl.search = redirectUrl.search
        ? `${redirectUrl.search}&${remaining}`
        : remaining
    }
    return NextResponse.redirect(redirectUrl)
  }

  // -------------------------------------------------------------------------
  // 9. Per-org metadata endpoints (sitemap, robots, podcast feed)
  // -------------------------------------------------------------------------
  if (pathname.match(/^\/podcast\/([^/]+)\/feed$/)) {
    const resolved = await resolveTenant(req, instance)
    const feedUrl = new URL(`/api${pathname}`, req.url)
    const response = NextResponse.rewrite(feedUrl)
    response.headers.set('X-Feed-Orgslug', resolved.slug)
    return response
  }
  if (pathname.startsWith('/sitemap.xml')) {
    const resolved = await resolveTenant(req, instance)
    const sitemapUrl = new URL(`/api/sitemap`, req.url)
    const response = NextResponse.rewrite(sitemapUrl)
    response.headers.set('X-Sitemap-Orgslug', resolved.slug)
    return response
  }
  if (pathname === '/robots.txt') {
    const resolved = await resolveTenant(req, instance)
    const robotsUrl = new URL(`/api/robots`, req.url)
    const response = NextResponse.rewrite(robotsUrl)
    response.headers.set('X-Robots-Orgslug', resolved.slug)
    return response
  }

  // -------------------------------------------------------------------------
  // 10. Apex root (multi tenancy only) — login-first, then org picker.
  //
  //     The bare apex (learnhouse.io) is NOT org-scoped. An unauthenticated
  //     visitor lands on the login page; once signed in they get the /home org
  //     picker and choose an org — which lives on its own subdomain
  //     ({slug}.learnhouse.io) or custom domain. Org content is ONLY served on
  //     a subdomain/custom domain, never at the apex. Mirrors the platform's
  //     "log in, then choose an org" flow. We branch on the non-httpOnly
  //     LH_session marker cookie (best-effort; the page itself re-verifies).
  // -------------------------------------------------------------------------
  if (
    instance.tenancy === 'multi'
    && pathname === '/'
    && fullhost
    && !isLocalhostCheck(fullhost)
    && !(await hostIsCustomDomain(fullhost, instance))
  ) {
    const resolved = await resolveTenant(req, instance)
    if (resolved.source === 'default') {
      const hasSession = !!req.cookies.get('LH_session')?.value
      const target = hasSession
        ? `${DEFAULT_LEARNER_DESTINATION}${search}`
        : `/auth/login${search}`
      const requestHeaders = tenantRequestHeaders(req, resolved, instance)
      const response = NextResponse.rewrite(new URL(target, req.url), {
        request: { headers: requestHeaders },
      })
      setOrgCookies(response, resolved, instance)
      setInstanceCookies(response, instance)
      return response
    }
  }

  // -------------------------------------------------------------------------
  // 11. Tenant-scoped rewrite — the catch-all that puts us under /orgs/{slug}
  // -------------------------------------------------------------------------
  const resolved = await resolveTenant(req, instance)
  const requestHeaders = tenantRequestHeaders(req, resolved, instance)
  // `${search}` is load-bearing: a rewrite destination built from an absolute
  // path drops the base URL's query, and Next treats the destination's search
  // as the request's. Every other branch above appends it; this one did not, so
  // org-scoped pages lost their query string (?page, ?q, ?tab, …).
  const response = NextResponse.rewrite(
    new URL(`/orgs/${resolved.slug}${pathname}${search}`, req.url),
    { request: { headers: requestHeaders } },
  )
  setOrgCookies(response, resolved, instance)
  setInstanceCookies(response, instance)
  return response
}

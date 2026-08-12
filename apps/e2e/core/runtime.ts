const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

type RuntimeEnvironment = Record<string, string | undefined>

export interface LocalRuntime {
  trellis: URL
  academy: URL
  api: URL
}

export interface OutboundWriteAttempt {
  method: string
  url: string
}

export function assertLoopbackUrl(raw: string, label: string): URL {
  const url = new URL(raw)
  if (url.protocol !== 'http:') {
    throw new Error(`${label} must use local HTTP`)
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`${label} must use a loopback hostname`)
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not contain credentials`)
  }
  if (!url.port) {
    throw new Error(`${label} must use an explicit port`)
  }
  return url
}

export function resolveLocalRuntime(env: RuntimeEnvironment): LocalRuntime {
  const trellisRaw = env.E2E_TRELLIS_URL
  const academyRaw = env.E2E_BASE_URL
  const apiRaw = env.E2E_API_URL
  if (!trellisRaw || !academyRaw || !apiRaw) {
    throw new Error('E2E_TRELLIS_URL, E2E_BASE_URL, and E2E_API_URL are required')
  }

  const trellis = assertLoopbackUrl(trellisRaw, 'Trellis')
  const academy = assertLoopbackUrl(academyRaw, 'Academy')
  const api = assertLoopbackUrl(apiRaw, 'Academy API')
  if (api.pathname.replace(/\/$/, '') !== '/api/v1') {
    throw new Error('E2E_API_URL must end in /api/v1')
  }
  if (new Set([trellis.origin, academy.origin, api.origin]).size !== 3) {
    throw new Error('Trellis, Academy, and Academy API require distinct origins')
  }
  return { trellis, academy, api }
}

export function sanitizeAcademyDestination(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  if (/[\r\n]/.test(raw)) return '/'
  return raw
}

export function isLoopbackUrl(raw: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(raw).hostname)
  } catch (error) {
    throw new Error(`Invalid observed request URL: ${raw}`, { cause: error })
  }
}

export class LocalOutboundWriteReceipt {
  readonly attempts: OutboundWriteAttempt[] = []

  observe(method: string, url: string): void {
    const normalizedMethod = method.toUpperCase()
    if (WRITE_METHODS.has(normalizedMethod) && !isLoopbackUrl(url)) {
      this.attempts.push({ method: normalizedMethod, url })
    }
  }

  assertEmpty(): void {
    if (this.attempts.length === 0) return
    const summary = this.attempts.map((attempt) => `${attempt.method} ${attempt.url}`).join('\n')
    throw new Error(`External provider writes were attempted:\n${summary}`)
  }
}

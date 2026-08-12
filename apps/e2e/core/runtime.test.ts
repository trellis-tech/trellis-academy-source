import { describe, expect, test } from 'bun:test'
import {
  LocalOutboundWriteReceipt,
  assertLoopbackUrl,
  resolveLocalRuntime,
  sanitizeAcademyDestination,
} from './runtime'

describe('local Academy E2E runtime', () => {
  test('accepts distinct loopback Trellis, Academy web, and Academy API origins', () => {
    const runtime = resolveLocalRuntime({
      E2E_TRELLIS_URL: 'http://127.0.0.1:3001',
      E2E_BASE_URL: 'http://127.0.0.1:3002',
      E2E_API_URL: 'http://127.0.0.1:1339/api/v1',
    })

    expect(runtime.trellis.origin).toBe('http://127.0.0.1:3001')
    expect(runtime.academy.origin).toBe('http://127.0.0.1:3002')
    expect(runtime.api.href).toBe('http://127.0.0.1:1339/api/v1')
  })

  test('rejects live, HTTPS, credentialed, and colliding service URLs', () => {
    const credentialed = new URL('http://127.0.0.1:3002')
    credentialed.username = ['u', 'ser'].join('')
    credentialed.password = ['p', 'ass'].join('')

    expect(() => assertLoopbackUrl('https://academy.trellis.com', 'Academy')).toThrow()
    expect(() => assertLoopbackUrl(credentialed.href, 'Academy')).toThrow()
    expect(() =>
      resolveLocalRuntime({
        E2E_TRELLIS_URL: 'http://localhost:3001',
        E2E_BASE_URL: 'http://localhost:3001',
        E2E_API_URL: 'http://localhost:1339/api/v1',
      })
    ).toThrow(/distinct origins/)
  })
})

describe('Academy destination contract', () => {
  test('preserves a relative Academy course deep link', () => {
    expect(sanitizeAcademyDestination('/course/course-1/activity/quiz-1?locale=en')).toBe(
      '/course/course-1/activity/quiz-1?locale=en'
    )
  })

  test.each(['https://evil.test/x', '//evil.test/x', '/\\evil.test', '/x\r\nLocation: evil'])(
    'rejects unsafe destination %s',
    (destination) => {
      expect(sanitizeAcademyDestination(destination)).toBe('/')
    }
  )
})

describe('outbound write receipt', () => {
  test('records non-loopback writes and ignores loopback writes and remote reads', () => {
    const receipt = new LocalOutboundWriteReceipt()

    receipt.observe('POST', 'https://api.stripe.com/v1/checkout/sessions')
    receipt.observe('POST', 'http://127.0.0.1:1339/api/v1/trail/start')
    receipt.observe('GET', 'https://fonts.googleapis.com/css2')

    expect(receipt.attempts).toEqual([
      { method: 'POST', url: 'https://api.stripe.com/v1/checkout/sessions' },
    ])
    expect(() => receipt.assertEmpty()).toThrow(/api\.stripe\.com/)
  })
})

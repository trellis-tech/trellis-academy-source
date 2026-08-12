import { describe, expect, test } from 'bun:test'
import { requireProductEndpoint } from './productContract'

describe('required product endpoint contract', () => {
  test('reports an unimplemented endpoint without substituting a mock', async () => {
    const fetcher = () => Promise.resolve(new Response('not found', { status: 404 }))

    await expect(
      requireProductEndpoint(
        fetcher,
        'http://127.0.0.1:3001/api/academy/sso/authorize',
        'Trellis Academy SSO issuer'
      )
    ).rejects.toThrow(/product endpoint is not implemented/)
  })

  test('accepts an implemented endpoint even when authentication is required', async () => {
    const fetcher = () => Promise.resolve(new Response('unauthorized', { status: 401 }))

    await expect(
      requireProductEndpoint(
        fetcher,
        'http://127.0.0.1:3001/api/academy/sso/authorize',
        'Trellis Academy SSO issuer'
      )
    ).resolves.toBeUndefined()
  })
})

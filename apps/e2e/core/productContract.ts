type EndpointFetch = (input: string, init?: RequestInit) => Promise<Response>

export async function requireProductEndpoint(
  fetcher: EndpointFetch,
  url: string,
  label: string,
  init?: RequestInit
): Promise<void> {
  const response = await fetcher(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 404 || response.status === 405) {
    throw new Error(
      `${label} product endpoint is not implemented at ${url} (status ${response.status}); ` +
        'the Academy E2E harness will not replace it with a mock.'
    )
  }
}

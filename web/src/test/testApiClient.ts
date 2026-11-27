import { createApiClient, type ApiClientOptions } from '../api/client'
import { sessionToken } from './sessionToken'

const TEST_USER_ID = 'user_a'

/** An API client against a test server, signed in as `TEST_USER_ID`, that sends through `fetch`. */
export function testApiClient(
  fetch: NonNullable<ApiClientOptions['fetch']>,
  overrides: Partial<ApiClientOptions> = {},
) {
  return createApiClient({
    baseUrl: 'http://api.test',
    getToken: async () => sessionToken(TEST_USER_ID),
    userId: TEST_USER_ID,
    clientVersion: '1',
    fetch,
    ...overrides,
  })
}

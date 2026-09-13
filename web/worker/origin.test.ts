// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { apiOrigin, previewAlias, type OriginEnv } from './origin'

const WORKER = 'crosstune-web'

function makeEnv(get: OriginEnv['PREVIEW_API_ORIGINS']['get']): OriginEnv {
  return {
    WORKER_NAME: WORKER,
    API_ORIGIN_PRODUCTION: 'https://api.example.com',
    API_ORIGIN_DEVELOPMENT: 'https://api-development.up.railway.app',
    PREVIEW_API_ORIGINS: { get },
  }
}

describe('previewAlias', () => {
  it('reads the alias from an aliased preview hostname', () => {
    expect(previewAlias('feat-tunings-crosstune-web.acme.workers.dev', WORKER)).toBe('feat-tunings')
  })

  it('returns null for the bare workers.dev hostname', () => {
    expect(previewAlias('crosstune-web.acme.workers.dev', WORKER)).toBeNull()
  })

  it('returns null for the production domain', () => {
    expect(previewAlias('example.com', WORKER)).toBeNull()
  })

  it('returns null for another worker on workers.dev', () => {
    expect(previewAlias('feat-tunings-other-worker.acme.workers.dev', WORKER)).toBeNull()
  })

  it('returns null when the alias would be empty', () => {
    expect(previewAlias('-crosstune-web.acme.workers.dev', WORKER)).toBeNull()
  })
})

describe('apiOrigin', () => {
  it('uses the production API for any hostname outside workers.dev', async () => {
    const env = makeEnv(async () => 'https://should-not-be-read.example')
    expect(await apiOrigin('example.com', env)).toBe('https://api.example.com')
  })

  it('uses the development API for the bare workers.dev hostname', async () => {
    const env = makeEnv(async () => 'https://should-not-be-read.example')
    expect(await apiOrigin('crosstune-web.acme.workers.dev', env)).toBe(
      'https://api-development.up.railway.app',
    )
  })

  it('uses the stored origin for an aliased preview', async () => {
    const seen: string[] = []
    const env = makeEnv(async (key) => {
      seen.push(key)
      return 'https://api-pr-7.up.railway.app'
    })
    expect(await apiOrigin('feat-tunings-crosstune-web.acme.workers.dev', env)).toBe(
      'https://api-pr-7.up.railway.app',
    )
    expect(seen).toEqual(['feat-tunings'])
  })

  it('falls back to the development API when the alias has no entry', async () => {
    const env = makeEnv(async () => null)
    expect(await apiOrigin('feat-tunings-crosstune-web.acme.workers.dev', env)).toBe(
      'https://api-development.up.railway.app',
    )
  })

  it('falls back to the development API when the KV read fails', async () => {
    const env = makeEnv(async () => {
      throw new Error('kv unavailable')
    })
    expect(await apiOrigin('feat-tunings-crosstune-web.acme.workers.dev', env)).toBe(
      'https://api-development.up.railway.app',
    )
  })
})

import type { Breadcrumb } from '@sentry/react'

// R2 presigned URLs carry their authorization in the query string itself, so a request
// breadcrumb must not keep it around.
const R2_HOST_SUFFIX = '.r2.cloudflarestorage.com'

/** Drop the query string from a fetch or xhr breadcrumb's url when it points at R2. */
export function scrubR2Breadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.category !== 'fetch' && breadcrumb.category !== 'xhr') return breadcrumb
  const url = breadcrumb.data?.url
  if (typeof url !== 'string') return breadcrumb
  let host: string
  try {
    host = new URL(url).host
  } catch {
    return breadcrumb
  }
  if (!host.endsWith(R2_HOST_SUFFIX)) return breadcrumb
  return { ...breadcrumb, data: { ...breadcrumb.data, url: url.split('?', 1)[0] } }
}

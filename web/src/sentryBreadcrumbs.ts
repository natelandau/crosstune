import type { Breadcrumb } from '@sentry/react'

/**
 * Drop the query string from a fetch or xhr breadcrumb's url. Query strings carry search
 * text and presigned-URL credentials, and neither belongs in an error report.
 */
export function scrubBreadcrumbUrl(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.category !== 'fetch' && breadcrumb.category !== 'xhr') return breadcrumb
  const url = breadcrumb.data?.url
  if (typeof url !== 'string' || !url.includes('?')) return breadcrumb
  return { ...breadcrumb, data: { ...breadcrumb.data, url: url.split('?', 1)[0] } }
}

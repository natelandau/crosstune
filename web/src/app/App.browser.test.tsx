import { page } from 'vitest/browser'
import { expect, it } from 'vitest'
import type { RouteObject } from 'react-router'
import { openTestDb } from '../test/db'
import { renderApp } from '../test/renderApp'
import { appRoutes } from './routes'

it('mounts the kit at /kit', async () => {
  await renderApp({ path: '/kit', db: openTestDb() })
  await expect.element(page.getByRole('heading', { name: 'Kit', level: 1 })).toBeVisible()
})

it('leaves /kit out of the route table outside a dev server', () => {
  const paths = (list: RouteObject[]): string[] =>
    list.flatMap((route) => [route.path ?? '', ...paths(route.children ?? [])])
  expect(paths(appRoutes(true))).toContain('/kit')
  expect(paths(appRoutes(false))).toContain('/catalog')
  expect(paths(appRoutes(false))).not.toContain('/kit')
})

it('mounts the catalog landmark at /catalog', async () => {
  await renderApp({ path: '/catalog', db: openTestDb() })
  await expect.element(page.getByRole('main', { name: 'Catalog' })).toBeVisible()
})

it('redirects the root to the catalog', async () => {
  await renderApp({ path: '/', db: openTestDb() })
  await expect.element(page.getByRole('main', { name: 'Catalog' })).toBeVisible()
})

it('stamps the density the test asks for on the root', async () => {
  await renderApp({ path: '/catalog', db: openTestDb(), density: 'touch' })
  await expect.poll(() => document.documentElement.dataset.density).toBe('touch')
})

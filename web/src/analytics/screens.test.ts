import type { RouteObject } from 'react-router'
import { expect, it } from 'vitest'
import { appRoutes } from '../app/routes'
import { screenFor } from './screens'

// The addresses that show no screen: redirects, the component kit, and the not-found page.
const NOT_SCREENS = ['/', '/kit', '/tunes/:tuneId', '/*']

function routePaths(routes: RouteObject[], parent = ''): string[] {
  return routes.flatMap((route) => {
    const path =
      route.path === undefined
        ? parent
        : route.path.startsWith('/')
          ? route.path
          : `${parent}/${route.path}`
    const own = route.path !== undefined || route.index ? [path] : []
    return [...own, ...routePaths(route.children ?? [], path)]
  })
}

it.each([
  ['/catalog', 'catalog'],
  ['/catalog/t1', 'tune'],
  ['/lists', 'lists'],
  ['/lists/l1', 'list'],
  ['/lists/l1/tunes/t1', 'tune'],
  ['/recordings', 'recordings'],
  ['/recordings/t1', 'tune'],
  ['/settings', 'settings'],
  ['/settings/appearance', 'settings'],
  ['/settings/stats', 'stats'],
  ['/settings/stats/tunes/t1', 'tune'],
])('maps %s to %s', (path, screen) => {
  expect(screenFor(path, false)).toBe(screen)
})

it('maps the not-found page and the kit to nothing', () => {
  expect(screenFor('/catalog/t1', true)).toBeNull()
  expect(screenFor('/nowhere', true)).toBeNull()
  expect(screenFor('/kit', false)).toBeNull()
  expect(screenFor('/', false)).toBeNull()
})

it('maps every route the app has to a screen, or knows it shows none', () => {
  const paths = [...new Set(routePaths(appRoutes(true)))]
  expect(paths).toEqual(expect.arrayContaining(NOT_SCREENS))
  for (const path of paths) {
    const address = path.replaceAll(/:\w+/g, 'x1')
    if (NOT_SCREENS.includes(path)) expect(screenFor(address, false), path).toBeNull()
    else expect(screenFor(address, false), path).not.toBeNull()
  }
})

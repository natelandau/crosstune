import { createContext, forwardRef, memo } from 'react'
import { page, userEvent } from 'vitest/browser'
import { expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { CONTROLS, NOT_LIBRARY_CONTROLS } from '../ui'
import { ComponentGallery, GALLERY_TITLE } from './ComponentGallery'

it('stamps the density and scheme a test asks for on the root', async () => {
  renderWithProviders(<ComponentGallery />, { density: 'touch', scheme: 'dark' })
  expect(document.documentElement.dataset.density).toBe('touch')
  expect(document.documentElement.dataset.scheme).toBe('dark')
})

it('switches the whole page density from one control', async () => {
  renderWithProviders(<ComponentGallery />, { density: 'touch' })
  await userEvent.click(page.getByRole('button', { name: 'Pointer' }))
  await expect.poll(() => document.documentElement.dataset.density).toBe('pointer')
})

it('shows every exported control under a heading of its name', async () => {
  renderWithProviders(<ComponentGallery />, { density: 'pointer' })
  for (const control of CONTROLS) {
    await expect
      .element(page.getByRole('heading', { name: control.name, exact: true }))
      .toBeInTheDocument()
  }
})

const MODULES = import.meta.glob<Record<string, unknown>>(
  ['../ui/*.tsx', '../ui/form/*.tsx', '!**/*.test.tsx', '!**/*.browser.test.tsx'],
  { eager: true },
)

const WRAPPED_COMPONENTS = new Set([Symbol.for('react.memo'), Symbol.for('react.forward_ref')])

/**
 * Whether a module export is a component: a capitalized name with a lowercase letter somewhere,
 * so `URLField` counts and a constant such as `TAP_AREA` does not, holding a function or a
 * `memo` or `forwardRef` wrapper.
 */
function isComponentExport(name: string, value: unknown): boolean {
  if (!/^[A-Z]/.test(name) || !/[a-z]/.test(name)) return false
  if (typeof value === 'function') return true
  return (
    typeof value === 'object' &&
    value !== null &&
    WRAPPED_COMPONENTS.has((value as { $$typeof?: symbol }).$$typeof as symbol)
  )
}

it('counts acronym-first and wrapped components as components, and nothing else', () => {
  const Plain = () => null
  expect(isComponentExport('URLField', Plain)).toBe(true)
  expect(isComponentExport('Card', memo(Plain))).toBe(true)
  expect(isComponentExport('Field', forwardRef(Plain))).toBe(true)
  expect(isComponentExport('InRow', createContext(false))).toBe(false)
  expect(isComponentExport('TAP_AREA', 'relative')).toBe(false)
  expect(isComponentExport('useLatest', Plain)).toBe(false)
})

it('lists every component the ui folders export as a control or an exclusion', () => {
  const exported = Object.values(MODULES).flatMap((module) =>
    Object.entries(module)
      .filter(([name, value]) => isComponentExport(name, value))
      .map(([name]) => name),
  )
  const listed = new Set([
    ...CONTROLS.map((control) => control.name),
    ...Object.keys(NOT_LIBRARY_CONTROLS),
  ])
  expect(exported.filter((name) => !listed.has(name))).toEqual([])
  expect(CONTROLS.filter((control) => !exported.includes(control.name)).map((c) => c.name)).toEqual(
    [],
  )
  expect(Object.keys(NOT_LIBRARY_CONTROLS).filter((name) => !exported.includes(name))).toEqual([])
})

it('has no app content', async () => {
  renderWithProviders(<ComponentGallery />, { density: 'pointer' })
  await expect.element(page.getByRole('heading', { name: GALLERY_TITLE, level: 1 })).toBeVisible()
  expect(document.body.textContent).not.toMatch(/tune|recording|practice|violin/i)
})

it('opens a locked sheet that keeps typed work on Escape', async () => {
  renderWithProviders(<ComponentGallery />, { density: 'touch' })
  await page.getByRole('button', { name: 'Locked sheet' }).click()
  await page.getByRole('textbox', { name: 'Title' }).fill('Example')
  await userEvent.keyboard('{Escape}')
  const sheet = page.getByRole('dialog', { name: 'New item' })
  await expect.element(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
})

it('asks a cautionary question for the caution demo', async () => {
  renderWithProviders(<ComponentGallery />, { density: 'pointer' })
  await page.getByRole('button', { name: 'Confirm caution' }).click()
  const alert = page.getByRole('alertdialog', { name: 'Archive "Example"?' })
  await expect.element(alert).toBeVisible()
  await alert.getByRole('button', { name: 'Archive' }).click()
  await expect.element(page.getByText('Confirmed')).toBeVisible()
})

it('shows the size guides from one toggle', async () => {
  renderWithProviders(<ComponentGallery />, { density: 'pointer' })
  expect(document.querySelector('[data-size-guide]')).toBeNull()
  await page.getByRole('button', { name: 'Show size guides' }).click()
  await expect.poll(() => document.querySelector('[data-size-guide]')).not.toBeNull()
})

it('shows a button working, then done', async () => {
  renderWithProviders(<ComponentGallery />, { density: 'pointer' })
  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect.element(page.getByRole('button', { name: 'Sync now' })).toBeEnabled()
})

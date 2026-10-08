import { page, userEvent } from 'vitest/browser'
import { expect, it } from 'vitest'
import { renderWithProviders } from '../test/render'
import { KitPage } from './KitPage'

it('renders the kit page in Geist', async () => {
  renderWithProviders(<KitPage />)
  await expect.element(page.getByRole('heading', { name: 'Kit', level: 1 })).toBeVisible()
  await expect.poll(() => getComputedStyle(document.body).fontFamily).toContain('Geist')
})

it('stamps the density and scheme a test asks for on the root', async () => {
  renderWithProviders(<KitPage />, { density: 'touch', scheme: 'dark' })
  expect(document.documentElement.dataset.density).toBe('touch')
  expect(document.documentElement.dataset.scheme).toBe('dark')
})

it('keeps a 16px gutter and spaces its sections apart', async () => {
  renderWithProviders(<KitPage />, { density: 'touch' })
  const title = page.getByRole('heading', { name: 'Kit', level: 1 })
  await expect.element(title).toBeVisible()
  expect(title.element().getBoundingClientRect().left).toBe(16)
  const [first, second] = document.querySelectorAll('main > section')
  expect(second!.getBoundingClientRect().top - first!.getBoundingClientRect().bottom).toBe(32)
})

it('switches the whole page density from one control', async () => {
  renderWithProviders(<KitPage />, { density: 'touch' })
  await userEvent.click(page.getByRole('button', { name: 'Pointer' }))
  await expect.poll(() => document.documentElement.dataset.density).toBe('pointer')
})

it('opens a locked sheet that keeps typed work on Escape', async () => {
  renderWithProviders(<KitPage />, { density: 'touch' })
  await page.getByRole('button', { name: 'Locked sheet' }).click()
  await page.getByRole('textbox', { name: 'Title' }).fill('Sally Goodin')
  await userEvent.keyboard('{Escape}')
  await expect.element(page.getByRole('dialog', { name: 'New tune' })).toBeVisible()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
})

it('asks a cautionary question for the caution demo', async () => {
  renderWithProviders(<KitPage />, { density: 'pointer' })
  await page.getByRole('button', { name: 'Confirm caution' }).click()
  const alert = page.getByRole('alertdialog', { name: 'Archive "Soldier\'s Joy"?' })
  await expect.element(alert).toBeVisible()
  await alert.getByRole('button', { name: 'Archive' }).click()
  await expect.element(page.getByText('Confirmed')).toBeVisible()
})

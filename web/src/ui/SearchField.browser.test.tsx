import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { openTestDb } from '../test/db'
import { renderIonic } from '../test/ionic'
import { SearchField, type SearchFieldHandle } from './SearchField'

function Host({ onEnter = () => {} }: { onEnter?: () => void }) {
  const [value, setValue] = useState('')
  const field = useRef<SearchFieldHandle>(null)
  return (
    <>
      <SearchField
        ref={field}
        name="Search songs"
        value={value}
        onInput={setValue}
        onEnter={onEnter}
      />
      <output data-testid="value">{value}</output>
      <button type="button" onClick={() => field.current?.focus()}>
        Focus
      </button>
    </>
  )
}

const input = () => page.getByRole('searchbox', { name: 'Search songs' })
const value = () => document.querySelector('[data-testid=value]')!.textContent

describe('SearchField', () => {
  it('names the input once and leaves the search landmark unnamed', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await expect.element(input()).toBeVisible()
    await expect.element(page.getByRole('search')).not.toHaveAttribute('aria-label')
    await expect.element(input()).toHaveAttribute('placeholder', 'Search songs')
  })

  it('reports typing and clears from its clear button', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await input().fill('cluck')
    await expect.poll(value).toBe('cluck')
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect.poll(value).toBe('')
    await expect.element(input()).toHaveValue('')
  })

  it('submits on Enter but not while an input method is composing', async () => {
    const onEnter = vi.fn()
    renderIonic(<Host onEnter={onEnter} />, { db: openTestDb() })
    await input().fill('ka')
    const native = input().element() as HTMLInputElement
    native.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    )
    expect(onEnter).not.toHaveBeenCalled()
    await userEvent.keyboard('{Enter}')
    expect(onEnter).toHaveBeenCalledOnce()
  })

  it('takes focus through its handle', async () => {
    renderIonic(<Host />, { db: openTestDb() })
    await expect.element(input()).toBeVisible()
    await page.getByRole('button', { name: 'Focus' }).click()
    await vi.waitFor(() => expect(document.activeElement).toBe(input().element()))
  })
})

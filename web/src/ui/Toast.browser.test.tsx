import { IonButton } from '@ionic/react'
import { screen, waitFor } from '@testing-library/react'
import { useEffect, useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { openTestDb } from '../test/db'
import { renderIonic } from '../test/ionic'
import { useToast } from './Toast'

function Host({ undo }: { undo?: () => void }) {
  const toast = useToast()
  return (
    <>
      <IonButton onClick={() => toast({ message: '3 songs archived', undo })}>Archive</IonButton>
      <IonButton onClick={() => toast({ message: 'Saved' })}>Save</IonButton>
      <IonButton
        onClick={() => {
          toast({ message: 'First' })
          toast({ message: 'Second' })
        }}
      >
        Double
      </IonButton>
      <IonButton
        onClick={() => {
          toast({ message: 'First' })
          toast({ message: 'Second' })
          toast({ message: 'Third' })
        }}
      >
        Triple
      </IonButton>
    </>
  )
}

/** Hoists a call site's toast function to the parent so two independent useToast() calls
 *  can be fired from a single click, proving the burst runs through one shared overlay. */
function CallSite({ message, capture }: { message: string; capture: (fn: () => void) => void }) {
  const toast = useToast()
  useEffect(() => {
    capture(() => toast({ message }))
  }, [toast, message, capture])
  return null
}

function TwoCallSites() {
  const fns = useRef<Array<() => void>>([])
  return (
    <>
      <CallSite message="From A" capture={(fn) => (fns.current[0] = fn)} />
      <CallSite message="From B" capture={(fn) => (fns.current[1] = fn)} />
      <IonButton
        onClick={() => {
          fns.current[0]?.()
          fns.current[1]?.()
        }}
      >
        Trigger both
      </IonButton>
    </>
  )
}

/**
 * A screen whose bottom chrome is away when the message is raised and back a tick later, the
 * way a bulk action leaves selection: the tab bar returns as the toast goes up.
 */
function ReturningChrome({ comesBack = true }: { comesBack?: boolean }) {
  const toast = useToast()
  const [back, setBack] = useState(false)
  return (
    <>
      <IonButton
        onClick={() => {
          toast({ message: 'Set 2 songs to Known' })
          setBack(comesBack)
        }}
      >
        Act
      </IonButton>
      <div
        data-toast-anchor
        style={{
          display: back ? 'block' : 'none',
          position: 'fixed',
          insetInline: 0,
          bottom: 0,
          height: '56px',
        }}
      />
    </>
  )
}

describe('useToast', () => {
  it('waits for the bottom chrome to come back before it lands', async () => {
    renderIonic(<ReturningChrome />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('Act'))
    await expect.element(page.getByText('Set 2 songs to Known')).toBeVisible()
    const wrapper = document
      .querySelector('ion-toast')!
      .shadowRoot!.querySelector('.toast-wrapper')!
    const anchor = document.querySelector('[data-toast-anchor]')!
    await vi.waitFor(() =>
      expect(wrapper.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        anchor.getBoundingClientRect().top + 1,
      ),
    )
  })

  it('waits for no tab bar on the wide frame, which carries a sidebar instead', async () => {
    await page.viewport(1024, 768)
    try {
      renderIonic(<ReturningChrome comesBack={false} />, { db: openTestDb() })
      await userEvent.click(await screen.findByText('Act'))
      const started = performance.now()
      await expect.element(page.getByText('Set 2 songs to Known')).toBeVisible()
      // Comfortably inside the wait a phone frame allows its tab bar, which this frame has no
      // reason to sit through.
      expect(performance.now() - started).toBeLessThan(1000)
    } finally {
      await page.viewport(390, 844)
    }
  })

  it('shows the message with an undo button that runs the undo', async () => {
    const undo = vi.fn()
    renderIonic(<Host undo={undo} />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('Archive'))
    await expect.element(page.getByText('3 songs archived')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await waitFor(() => expect(undo).toHaveBeenCalledOnce())
  })

  it('replaces an earlier toast and drops its undo', async () => {
    const undo = vi.fn()
    renderIonic(<Host undo={undo} />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('Archive'))
    await expect.element(page.getByText('3 songs archived')).toBeVisible()
    await userEvent.click(screen.getByText('Save'))
    await expect.element(page.getByText('Saved')).toBeVisible()
    await expect.poll(() => page.getByRole('button', { name: 'Undo' }).elements()).toHaveLength(0)
    expect(undo).not.toHaveBeenCalled()
  })

  it('keeps working when an undo handler throws', async () => {
    const undo = vi.fn(() => {
      throw new Error('boom')
    })
    renderIonic(<Host undo={undo} />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('Archive'))
    await expect.element(page.getByText('3 songs archived')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await waitFor(() => expect(undo).toHaveBeenCalledOnce())
    await userEvent.click(screen.getByText('Save'))
    await expect.element(page.getByText('Saved')).toBeVisible()
  })

  it('keeps working when an undo handler rejects', async () => {
    const undo = vi.fn(() => Promise.reject(new Error('boom')))
    renderIonic(<Host undo={undo} />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('Archive'))
    await expect.element(page.getByText('3 songs archived')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await waitFor(() => expect(undo).toHaveBeenCalledOnce())
    await userEvent.click(screen.getByText('Save'))
    await expect.element(page.getByText('Saved')).toBeVisible()
  })

  it('shows only the last toast when two calls fire in the same tick', async () => {
    renderIonic(<Host undo={() => {}} />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('Double'))
    await expect.element(page.getByText('Second')).toBeVisible()
    await expect.poll(() => page.getByText('First').elements()).toHaveLength(0)
  })

  it('never presents a superseded message during a burst', async () => {
    // Ionic sets an overlay's props on the element before inserting it, so an ion-toast
    // added to the DOM already carries its final message; a MutationObserver catches every
    // one that was ever inserted, including one presented and torn down between polls.
    const seen = new Set<string>()
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement && node.tagName.toLowerCase() === 'ion-toast') {
            const message = (node as unknown as { message?: string }).message
            if (message) seen.add(message)
          }
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })

    renderIonic(<Host undo={() => {}} />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('Triple'))
    await expect.element(page.getByText('Third')).toBeVisible()
    observer.disconnect()

    expect(seen).toEqual(new Set(['Third']))
  })

  it('shares one overlay across separate useToast() call sites', async () => {
    renderIonic(<TwoCallSites />, { db: openTestDb() })
    await userEvent.click(await screen.findByText('Trigger both'))
    await expect.element(page.getByText('From B')).toBeVisible()
    await expect.poll(() => page.getByText('From A').elements()).toHaveLength(0)
    await expect.poll(() => document.querySelectorAll('ion-toast')).toHaveLength(1)
  })
})

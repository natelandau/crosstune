import { Children, useLayoutEffect, useRef, type ReactNode } from 'react'

/** How much a row gave up to fit its labels: nothing, its icons, then its icons and padding. */
type Fit = 'full' | 'bare' | 'tightest'
const FITS: Fit[] = ['full', 'bare', 'tightest']

/** Whether a button's icon and label fit inside its padding. */
function contentFits(button: HTMLElement): boolean {
  const style = getComputedStyle(button)
  const range = document.createRange()
  range.selectNodeContents(button)
  const needed =
    range.getBoundingClientRect().width +
    parseFloat(style.paddingLeft) +
    parseFloat(style.paddingRight)
  return needed <= button.clientWidth + 0.5
}

/** Takes the first fit whose labels all fit. Set on the element rather than in state, so each
 * step is measured in the same frame. */
function fitRow(element: HTMLElement) {
  const buttons = [...element.querySelectorAll<HTMLElement>(':scope > div > button')]
  for (const step of FITS) {
    element.dataset.fit = step
    if (buttons.every(contentFits)) return
  }
}

/**
 * A page's main actions side by side, each taking an equal share of the width. A label never
 * wraps; `tight` narrows the gaps and each button's padding so three labels fit a phone. Where
 * the labels still do not fit, at a narrow window or a larger text size, the row drops its
 * icons, then narrows the padding further.
 */
export function VerbRow({ children, tight = false }: { children: ReactNode; tight?: boolean }) {
  const row = useRef<HTMLDivElement>(null)
  // Labels can change on any render, so each one refits.
  useLayoutEffect(() => {
    if (row.current) fitRow(row.current)
  })
  useLayoutEffect(() => {
    const element = row.current
    if (!element) return
    // The row's height follows the text size, so a text size change refits it too.
    const observer = new ResizeObserver(() => fitRow(element))
    observer.observe(element)
    // A web font swapping in changes label widths without resizing the row.
    const refit = () => fitRow(element)
    let live = true
    document.fonts.addEventListener('loadingdone', refit)
    void document.fonts.ready.then(() => {
      if (live) refit()
    })
    return () => {
      live = false
      observer.disconnect()
      document.fonts.removeEventListener('loadingdone', refit)
    }
  }, [])
  return (
    <div
      ref={row}
      data-fit="full"
      className={`group/verbs flex whitespace-nowrap ${tight ? 'gap-2' : 'gap-3'}`}
    >
      {Children.toArray(children).map((child, index) => (
        <div
          key={index}
          className={`min-w-0 flex-1 group-data-[fit=bare]/verbs:[&_svg]:hidden group-data-[fit=tightest]/verbs:[&_svg]:hidden group-data-[fit=tightest]/verbs:[&>button]:px-1 ${tight ? '[&>button]:px-2' : ''}`}
        >
          {child}
        </div>
      ))}
    </div>
  )
}

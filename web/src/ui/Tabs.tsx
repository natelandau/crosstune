import type { LucideIcon } from 'lucide-react'
import { motion, useReducedMotionConfig } from 'motion/react'
import { useContext, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Tab, TabList, TabPanel, Tabs as AriaTabs } from 'react-aria-components'
import { useStampedDensity } from '../platform/density'
import { DURATION, EASE_CSS, SPRING } from '../theme/motion'
import { InOverlay } from './inOverlay'
import { PRESS } from './press'
import { TAP_AREA } from './tapArea'

export interface TabItem<T extends string> {
  id: T
  label: string
  icon: LucideIcon
  isDisabled?: boolean
  /**
   * A longer label that is the tab's accessible name. It shows in place of `label` while every
   * tab's longer label fits on one line, which only equal-width (touch) tabs can run out of.
   */
  fullLabel?: string
}

const SLIDE = 12

const TAB =
  'text-secondary data-[selected]:text-accent hover:text-primary data-[selected]:hover:text-accent data-[hovered]:not-data-[selected]:bg-tint-subtle relative flex cursor-default items-center justify-center font-semibold tracking-[0.02em] data-[disabled]:opacity-40 data-[focus-visible]:rounded-(--radius)'
const STACKED_TAB =
  'min-h-[calc(var(--size-row)-4px)] flex-1 flex-col gap-1 px-1 pt-2 pb-2.5 text-xs'
const BESIDE_TAB =
  'mt-1 min-h-11 flex-row gap-1.5 rounded-t-(--radius-inner) px-4 py-0 text-[0.9375rem]'
// Stacked tabs run edge to edge, so the outer ones round with the card to keep a hover fill inside it.
const CARD_EDGE_TABS = 'first:rounded-tl-(--radius) last:rounded-tr-(--radius)'

/**
 * Tabs that swap the content below them, each an icon over a label on touch and inside a sheet or
 * popover, and beside it on pointer elsewhere. One panel stays mounted and slides in from the side
 * of the newly chosen tab.
 *
 * `container` says what holds the tabs: `card` draws the tab list as the header of a card that
 * holds the panel, for tabs that switch a panel inside a screen; `page` draws no card, for tabs
 * that switch a whole page or sheet, which is already the container.
 */
export function Tabs<T extends string>({
  label,
  tabs,
  selected,
  onChange,
  children,
  className,
  panelClassName,
  container = 'card',
  ...data
}: {
  /** The tab list's accessible name. */
  label: string
  tabs: readonly TabItem<T>[]
  selected: T
  onChange: (id: T) => void
  /** The panel for the chosen tab. */
  children: (id: T) => ReactNode
  className?: string
  panelClassName?: string | ((id: T) => string)
  /** A card around the tab list and panel, or none where a page or sheet already holds them. */
  container?: 'card' | 'page'
} & { [attribute: `data-${string}`]: boolean | undefined }) {
  const barId = useId()
  const density = useStampedDensity()
  // State rather than a ref: the tab list mounts after the first commit, and the fit effect must rerun then.
  const [list, setList] = useState<HTMLDivElement | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const index = tabs.findIndex((tab) => tab.id === selected)
  const previous = useRef(index)
  const fullLabels = tabs.map((tab) => tab.fullLabel ?? '').join('|')
  const inOverlay = useContext(InOverlay)
  const stacked = density === 'touch' || inOverlay
  const natural = !stacked
  const fits = useFullLabelsFit(list, natural, fullLabels)
  const reduceMotion = useReducedMotionConfig() ?? false
  const card = container === 'card'
  const panelClasses =
    typeof panelClassName === 'function' ? panelClassName(selected) : panelClassName

  useLayoutEffect(() => {
    const from = previous.current
    previous.current = index
    const element = panel.current
    if (!element || from === index) return
    const distance = reduceMotion ? 0 : SLIDE * Math.sign(index - from)
    const animation = element.animate(
      [
        { translate: `${distance}px 0`, opacity: 0 },
        { translate: '0 0', opacity: 1 },
      ],
      {
        duration: (reduceMotion ? DURATION.short : DURATION.base) * 1000,
        easing: EASE_CSS,
      },
    )
    return () => animation.cancel()
  }, [index, reduceMotion])

  return (
    <AriaTabs
      selectedKey={selected}
      onSelectionChange={(key) => onChange(key as T)}
      disabledKeys={tabs.filter((tab) => tab.isDisabled).map((tab) => tab.id)}
      className={[card && 'bg-surface rounded-(--radius)', className].filter(Boolean).join(' ')}
    >
      <TabList
        ref={setList}
        {...data}
        aria-label={label}
        className={`relative flex shadow-[inset_0_-1px_0_var(--border)] ${card && !stacked ? 'px-2' : ''}`}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon
          const name = tab.fullLabel ?? tab.label
          return (
            <Tab
              key={tab.id}
              id={tab.id}
              aria-label={name}
              className={`${TAB} ${stacked ? STACKED_TAB : BESIDE_TAB} ${card && stacked ? CARD_EDGE_TABS : ''} ${TAP_AREA} ${PRESS}`}
            >
              {({ isSelected }) => (
                <>
                  <motion.span
                    animate={{ scale: isSelected ? 1.08 : 1 }}
                    className="flex"
                    aria-hidden
                  >
                    <Icon className={stacked ? 'size-5.5' : 'size-5'} />
                  </motion.span>
                  <span data-tab-label>{fits ? name : tab.label}</span>
                  {tab.fullLabel && !natural && (
                    <span
                      data-full-label
                      aria-hidden
                      className="pointer-events-none invisible absolute top-0 left-0 whitespace-nowrap"
                    >
                      {tab.fullLabel}
                    </span>
                  )}
                  {isSelected && (
                    <motion.span
                      layoutId={barId}
                      transition={SPRING}
                      aria-hidden
                      className="bg-accent absolute inset-x-0 bottom-0 h-0.5 rounded-[2px]"
                    />
                  )}
                </>
              )}
            </Tab>
          )
        })}
      </TabList>
      <TabPanel
        ref={panel}
        id={selected}
        className={[card && 'p-4', panelClasses].filter(Boolean).join(' ') || undefined}
      >
        {children(selected)}
      </TabPanel>
    </AriaTabs>
  )
}

/**
 * Whether every tab's longer label fits its tab on one line. Tabs sized to their own content
 * always fit, so only the equal-width layout measures.
 */
function useFullLabelsFit(
  root: HTMLDivElement | null,
  natural: boolean,
  /** The longer labels, whose copies the measure reads; a change remeasures. */
  fullLabels: string,
): boolean {
  const [fits, setFits] = useState(true)
  useLayoutEffect(() => {
    if (!root || natural) return
    const copies = [...root.querySelectorAll<HTMLElement>('[data-full-label]')]
    const measure = () => {
      setFits(
        copies.every((copy) => {
          const tab = copy.parentElement!
          const style = getComputedStyle(tab)
          const room =
            tab.getBoundingClientRect().width -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight)
          return copy.getBoundingClientRect().width <= room
        }),
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    for (const copy of copies) {
      observer.observe(copy)
      observer.observe(copy.parentElement!)
    }
    return () => observer.disconnect()
  }, [root, natural, fullLabels])
  return natural || fits
}

import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * The element's client size, zero until it is first measured, kept current as it resizes. The
 * first measurement lands before paint, so a layout chosen from it never shows the wrong one.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>): {
  width: number
  height: number
} {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () =>
      setSize((prev) =>
        prev.width === element.clientWidth && prev.height === element.clientHeight
          ? prev
          : { width: element.clientWidth, height: element.clientHeight },
      )
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}

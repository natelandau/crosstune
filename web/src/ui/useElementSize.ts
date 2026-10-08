import { useEffect, useState, type RefObject } from 'react'

/** The element's client size, zero until it is first measured, kept current as it resizes. */
export function useElementSize(ref: RefObject<HTMLElement | null>): {
  width: number
  height: number
} {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = ref.current
    if (!element) return
    // An observer reports the size it starts with, so this also takes the first measurement.
    const observer = new ResizeObserver(() =>
      setSize((prev) =>
        prev.width === element.clientWidth && prev.height === element.clientHeight
          ? prev
          : { width: element.clientWidth, height: element.clientHeight },
      ),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}

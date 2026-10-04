import { useState, type DragEvent } from 'react'

export interface FileDrop {
  /** True while files are dragged over the target, to outline it. */
  over: boolean
  handlers: {
    onDragEnter?: (event: DragEvent) => void
    onDragOver?: (event: DragEvent) => void
    onDragLeave?: (event: DragEvent) => void
    onDrop?: (event: DragEvent) => void
  }
}

const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')

/**
 * Makes an element take files dropped on it, handing them to `onFiles`. Without `onFiles` it
 * takes nothing, so a drop there falls to the browser as before.
 */
export function useFileDrop(onFiles?: (files: File[]) => void): FileDrop {
  const [over, setOver] = useState(false)
  if (!onFiles) return { over: false, handlers: {} }
  return {
    over,
    handlers: {
      onDragEnter: (event) => {
        if (carriesFiles(event)) setOver(true)
      },
      onDragOver: (event) => {
        if (!carriesFiles(event)) return
        // Without this the browser refuses the drop, and opens the file in the tab instead.
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setOver(true)
      },
      onDragLeave: (event) => {
        // Crossing into a child fires leave on the parent too, so only a pointer that lands
        // outside the target has left it. A child removed mid-drag never fires its own leave,
        // which rules out counting enters against leaves.
        const into = event.relatedTarget
        if (into instanceof Node && event.currentTarget.contains(into)) return
        setOver(false)
      },
      onDrop: (event) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
        setOver(false)
        onFiles([...event.dataTransfer.files])
      },
    },
  }
}

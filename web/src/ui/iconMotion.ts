import {
  ArrowLeftToLine,
  ArrowRightToLine,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Plus,
  Repeat,
  RotateCcw,
  RotateCw,
  Shuffle,
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react'

// Under the pointer, a glyph moves the way its action goes. controls.css holds the motions.
const MOTION = new Map<LucideIcon, string>([
  [ChevronLeft, 'back'],
  [SkipBack, 'back'],
  [ArrowLeftToLine, 'back'],
  [ChevronRight, 'forward'],
  [SkipForward, 'forward'],
  [ArrowRightToLine, 'forward'],
  [ChevronDown, 'down'],
  [Plus, 'turn'],
  [Ellipsis, 'spread'],
  [Shuffle, 'twitch'],
  [RotateCcw, 'spin-back'],
  [RotateCw, 'spin-forward'],
  [Repeat, 'spin-forward'],
  [ZoomIn, 'grow'],
  [ZoomOut, 'shrink'],
])

/** The hover motion for a control's glyph, as its `data-motion`; none for a glyph with no direction. */
export function iconMotion(icon: LucideIcon): string | undefined {
  return MOTION.get(icon)
}

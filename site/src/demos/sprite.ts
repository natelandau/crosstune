// The page's icon sprite, built from lucide's icon data at build time. Each symbol is `i-NAME`.
import {
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Copy,
  Download,
  Ellipsis,
  FileText,
  Gauge,
  Headphones,
  List,
  Lock,
  MapPin,
  Mic,
  Music,
  PanelLeft,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  RotateCcw,
  RotateCw,
  Search,
  Settings,
  Share,
  SlidersHorizontal,
  Sun,
  Text,
  WifiOff,
  X,
} from 'lucide'
import type { IconNode } from 'lucide'

type Glyph = { icon: IconNode; filled?: boolean; weight?: number }

const ICONS: Record<string, Glyph> = {
  search: { icon: Search },
  check: { icon: Check, weight: 3.2 },
  check2: { icon: CircleCheck, weight: 2.2 },
  play: { icon: Play, filled: true },
  pause: { icon: Pause, filled: true },
  replay: { icon: RotateCcw, weight: 2.2 },
  left: { icon: ChevronLeft, weight: 2.4 },
  right: { icon: ChevronRight, weight: 2.4 },
  down: { icon: ChevronDown, weight: 2.4 },
  up: { icon: ArrowUp, weight: 2.2 },
  x: { icon: X, weight: 2.6 },
  plus: { icon: Plus, weight: 2.2 },
  more: { icon: Ellipsis, weight: 2.6 },
  music: { icon: Music },
  list: { icon: List },
  wave: { icon: AudioLines },
  mic: { icon: Mic },
  gear: { icon: Settings },
  pin: { icon: MapPin },
  text: { icon: Text },
  sun: { icon: Sun },
  download: { icon: Download },
  wifioff: { icon: WifiOff },
  sync: { icon: RefreshCw },
  loop: { icon: Repeat },
  sliders: { icon: SlidersHorizontal },
  ne: { icon: ArrowUpRight },
  lock: { icon: Lock, weight: 2.2 },
  sidebar: { icon: PanelLeft },
  share: { icon: Share },
  tabs: { icon: Copy },
  skipb: { icon: RotateCcw, weight: 1.8 },
  skipf: { icon: RotateCw, weight: 1.8 },
  file: { icon: FileText },
  head: { icon: Headphones },
  gauge: { icon: Gauge },
}

const attrs = (a: Record<string, string | number | undefined>) =>
  Object.entries(a)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ')

const symbol = (name: string, { icon, filled, weight = 2 }: Glyph) =>
  `<symbol id="i-${name}" viewBox="0 0 24 24" ${
    filled
      ? 'fill="currentColor" stroke="none"'
      : `fill="none" stroke="currentColor" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round"`
  }>${icon.map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join('')}</symbol>`

export const SPRITE = Object.entries(ICONS)
  .map(([name, s]) => symbol(name, s))
  .join('')

import {
  Activity,
  Copy,
  Download,
  Ellipsis,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Settings,
  Share,
  Star,
  Trash2,
  Users,
  Archive,
  ChevronDown,
  SlidersHorizontal,
  Upload,
  Volume2,
  Hash,
  X,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react'
import { animate } from 'motion/react'
import { useRef, useState, type ReactNode } from 'react'
import { DURATION, EASE, SPRING } from '../theme/motion'
import { Button } from '../ui/Button'
import { Capsule } from '../ui/Capsule'
import { DELETE, useConfirm, type ConfirmOptions } from '../ui/Confirm'
import { IconButton } from '../ui/IconButton'
import { InBar } from '../ui/inBar'
import { Menu } from '../ui/Menu'
import { PressableList, PressableOption, PressableRow } from '../ui/PressableRow'
import { RangeHandles } from '../ui/RangeHandles'
import { SearchField } from '../ui/SearchField'
import { SegmentedChoice } from '../ui/SegmentedChoice'
import { Sheet } from '../ui/Sheet'
import { Slider } from '../ui/Slider'
import { Stepper } from '../ui/Stepper'
import { Tabs, type TabItem } from '../ui/Tabs'
import { ToolPopover } from '../ui/ToolPopover'
import { useToast } from '../ui/Toast'
import { ButtonRow } from '../ui/form/ButtonRow'
import { Checkbox } from '../ui/form/Checkbox'
import { FieldRow } from '../ui/form/FieldRow'
import { Group } from '../ui/form/Group'
import { Picker } from '../ui/form/Picker'
import { SuggestField } from '../ui/form/SuggestField'
import { Switch } from '../ui/form/Switch'
import { TextField } from '../ui/form/TextField'

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** One control's section: its name as the heading, what it is for, then its live demos. */
export function ControlSection({
  control,
  purpose,
  children,
}: {
  control: { name: string }
  purpose: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="t-heading">{control.name}</h3>
      <p className="t-secondary text-secondary">{purpose}</p>
      {children}
    </section>
  )
}

function Demo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="t-caption text-secondary">{label}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

const SIZES = [
  ['Compact', '24 / 32', 'Switch, checkbox, chip, and every control at the end of a row.'],
  ['Regular', '28 / 36', 'Standalone buttons, icon buttons, segmented controls, steppers, search.'],
  ['Row', '40 / 48', 'Rows in a group. A Compact control plus 8px above and below.'],
  ['Large', '36 / 48', 'The one main action at the end of a sheet or a dialog.'],
] as const

/** A band the height of a Compact control, centered on its row, so the shared size shows. */
function Guided({ guides, children }: { guides: boolean; children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      {guides && (
        <span
          data-size-guide
          aria-hidden
          className="border-accent pointer-events-none absolute inset-x-0 top-1/2 h-(--size-compact) -translate-y-1/2 border-y border-dashed"
        />
      )}
    </div>
  )
}

export function FoundationsSection() {
  const [guides, setGuides] = useState(false)
  const [on, setOn] = useState(true)
  const [selected, setSelected] = useState(true)
  const [quantity, setQuantity] = useState(2)
  const [mode, setMode] = useState('auto')
  return (
    <section aria-labelledby="gallery-foundations" className="flex flex-col gap-3">
      <h2 id="gallery-foundations" className="t-heading">
        Foundations
      </h2>
      <p className="t-secondary text-secondary">
        Four heights, each with a pointer and a touch value. Every control uses one of them.
        Anything at the end of a row uses Compact, so every control lines up at the same height
        there.
      </p>
      <div>
        <Capsule label="Show size guides" isSelected={guides} onChange={setGuides} />
      </div>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SIZES.map(([name, value, use]) => (
          <div key={name} className="bg-surface rounded-(--radius) p-3">
            <dt className="t-body font-semibold">
              {name} <span className="t-num text-secondary font-normal">{value}</span>
            </dt>
            <dd className="t-secondary text-secondary">{use}</dd>
          </div>
        ))}
      </dl>
      <Group>
        <Guided guides={guides}>
          <Switch label="Notifications" isSelected={on} onChange={setOn} />
        </Guided>
        <Guided guides={guides}>
          <FieldRow label="Selected">
            <span className="flex-1" />
            <Checkbox label="Selected" isSelected={selected} onChange={setSelected} />
          </FieldRow>
        </Guided>
        <Guided guides={guides}>
          <FieldRow label="Quantity">
            <span className="flex-1" />
            <Stepper
              label="Quantity"
              nameGroup={false}
              value={quantity}
              min={0}
              max={10}
              format={String}
              decrementLabel="Decrease quantity"
              incrementLabel="Increase quantity"
              onChange={setQuantity}
            />
          </FieldRow>
        </Guided>
        <Guided guides={guides}>
          <FieldRow label="Mode">
            <span className="flex-1" />
            <SegmentedChoice
              label="Mode"
              segments={[
                { id: 'auto', label: 'Auto' },
                { id: 'manual', label: 'Manual' },
              ]}
              selected={mode}
              onChange={setMode}
            />
          </FieldRow>
        </Guided>
        <Guided guides={guides}>
          <FieldRow label="Tag">
            <span className="flex-1" />
            <Capsule label="Label" set />
          </FieldRow>
        </Guided>
        <Guided guides={guides}>
          <ButtonRow description="Plan" button={{ label: 'Change', onPress: () => {} }} />
        </Guided>
      </Group>
      <p className="t-secondary text-secondary">
        On touch, anything shorter than 44 extends its tap area to 44 without changing how it looks.
        Corners are 8px for every control and container, 6px for a segmented pill and 4px for a menu
        item. Chips and key pills are capsules; icon buttons, switches, checkboxes, and status dots
        are circles.
      </p>
    </section>
  )
}

const TIMINGS = [
  ['Instant 100ms', { duration: DURATION.instant, ease: 'linear' as const }],
  ['Quick 150ms', { duration: DURATION.short, ease: EASE }],
  ['Standard 250ms', { duration: DURATION.base, ease: EASE }],
  ['Spring ~350ms', SPRING],
] as const

function Timings() {
  const dots = useRef<(HTMLElement | null)[]>([])
  const right = useRef(false)
  const play = () => {
    right.current = !right.current
    TIMINGS.forEach(([, transition], index) => {
      const dot = dots.current[index]
      if (!dot) return
      const lane = dot.parentElement!.clientWidth - dot.clientWidth
      void animate(dot, { x: right.current ? lane : 0 }, transition)
    })
  }
  return (
    <div className="bg-surface flex flex-col gap-3 rounded-(--radius) p-3">
      <h3 className="t-heading">Four timings</h3>
      <p className="t-secondary text-secondary">Every animation uses one of these.</p>
      {TIMINGS.map(([name], index) => (
        <div key={name} className="flex items-center gap-3">
          <span className="t-secondary w-36 shrink-0">{name}</span>
          <div className="bg-field h-2 flex-1 rounded-full">
            <i
              ref={(node) => {
                dots.current[index] = node
              }}
              className="bg-accent block size-2 rounded-full"
            />
          </div>
        </div>
      ))}
      <div>
        <Button variant="secondary" label="Play" onPress={play} />
      </div>
      <p className="t-secondary text-secondary">
        Instant: hover color. Quick: press, color, anything leaving. Standard: fades, a thumb
        sliding. Spring: anything that moves to a new place. Leaving is always faster than arriving.
      </p>
    </div>
  )
}

export function MotionSection() {
  return (
    <section aria-labelledby="gallery-motion" className="flex flex-col gap-3">
      <h2 id="gallery-motion" className="t-heading">
        Motion
      </h2>
      <p className="t-secondary text-secondary">
        Motion confirms a press, shows where something went, and marks a finished task. It never
        plays on its own, never delays an action, and never loops except to show progress. With
        Reduce Motion on, movement, scale, and springs turn off; fades and color stay at Quick.
      </p>
      <Timings />
      <div className="bg-surface flex flex-col gap-3 rounded-(--radius) p-3">
        <h3 className="t-heading">Press and release</h3>
        <p className="t-secondary text-secondary">
          Presses in to 96% in 80ms, then springs back with a slight overshoot when released.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" label="Press me" />
          <IconButton icon={Plus} label="Press to add" variant="neutral" />
          <Capsule label="Chip" />
        </div>
      </div>
    </section>
  )
}

export function ActionsSection({ components }: { components: Record<string, { name: string }> }) {
  const [starred, setStarred] = useState(false)
  const [bell, setBell] = useState(true)
  return (
    <section aria-labelledby="gallery-actions" className="flex flex-col gap-8">
      <h2 id="gallery-actions" className="t-heading">
        Actions
      </h2>
      <ControlSection
        control={components.Button!}
        purpose="Any action with a label. Primary for the one main action in a view, Secondary for the others beside it, Text for low-weight actions, Destructive for deleting, Warning fill for a cautionary action."
      >
        <Demo label="Styles">
          <Button variant="primary" label="Save" />
          <Button variant="secondary" label="Share" />
          <Button variant="text" label="Edit" />
          <Button variant="destructive" label="Delete" />
          <Button variant="destructiveFill" label="Remove" />
          <Button variant="warningFill" label="Archive" />
        </Demo>
        <Demo label="Disabled">
          <Button variant="primary" label="Save" isDisabled />
          <Button variant="secondary" label="Share" isDisabled />
          <Button variant="text" label="Edit" isDisabled />
        </Demo>
        <Demo label="With an icon">
          <Button variant="primary" icon={Download} label="Download" />
          <Button variant="secondary" icon={Share} label="Share link" />
          <Button variant="text" icon={Plus} label="Add item" />
        </Demo>
        <Demo label="Working, then done, and blocked">
          <Button
            variant="secondary"
            icon={RefreshCw}
            label="Sync now"
            onPress={() => wait(1400)}
          />
          <Button variant="primary" label="Save changes" onPress={() => wait(150)} />
          <Button variant="primary" label="Submit" isBlocked />
        </Demo>
        <Demo label="Sizes">
          <Button variant="secondary" size="compact" label="Compact" />
          <Button variant="secondary" label="Regular" />
          <Button variant="primary" size="large" label="Large" />
        </Demo>
        <Demo label="In a bar: round, like the bar">
          <InBar value>
            <Button variant="secondary" label="Cancel" />
            <Button variant="primary" label="Done" />
          </InBar>
        </Demo>
      </ControlSection>
      <ControlSection
        control={components.IconButton!}
        purpose="An action shown only as an icon, always a circle. Plain for toolbar actions, Neutral on a busy surface, Toggle for on and off, Feature for the one main control of a media view, Destructive for deleting."
      >
        <Demo label="Plain, neutral, destructive, disabled">
          <IconButton icon={Ellipsis} label="More options" />
          <IconButton icon={Plus} label="Add" variant="neutral" />
          <IconButton icon={Trash2} label="Delete" variant="destructive" />
          <IconButton icon={Ellipsis} label="Unavailable options" isDisabled />
        </Demo>
        <Demo label="Toggle">
          <IconButton
            icon={Star}
            label="Star"
            variant="toggle"
            isSelected={starred}
            onChange={setStarred}
          />
          <IconButton
            icon={Activity}
            label="Notifications bell"
            variant="toggle"
            isSelected={bell}
            onChange={setBell}
          />
        </Demo>
        <Demo label="Sizes">
          <IconButton icon={Plus} label="Add compact" size="compact" variant="neutral" />
          <IconButton icon={Plus} label="Add regular" variant="neutral" />
          <IconButton icon={Plus} label="Add in a sheet" size="large" variant="neutral" />
          <IconButton icon={Plus} label="Add large" size="large44" variant="neutral" />
          <IconButton icon={RotateCw} label="Skip forward" size="transport" />
          <IconButton icon={Plus} label="Add feature" size="feature" variant="feature" />
        </Demo>
      </ControlSection>
    </section>
  )
}

type TabId = 'overview' | 'activity' | 'people' | 'settings'

const TABS: readonly TabItem<TabId>[] = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'people', label: 'People', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export function NavigationSection({
  components,
}: {
  components: Record<string, { name: string }>
}) {
  const [tab, setTab] = useState<TabId>('overview')
  const [view, setView] = useState('all')
  return (
    <section aria-labelledby="gallery-navigation" className="flex flex-col gap-8">
      <h2 id="gallery-navigation" className="t-heading">
        Navigation
      </h2>
      <ControlSection
        control={components.Tabs!}
        purpose="Switch between views of the same thing. The content below changes; nothing is saved."
      >
        <Demo label="Card: switches a panel inside a screen">
          <Tabs label="Sections" tabs={TABS} selected={tab} onChange={setTab} className="w-full">
            {(id) => <p className="t-body">{TABS.find((item) => item.id === id)?.label} content</p>}
          </Tabs>
        </Demo>
        <Demo label="Page: switches a whole page or sheet">
          <Tabs
            label="Views"
            container="page"
            tabs={[
              { id: 'all', label: 'All', icon: List },
              { id: 'starred', label: 'Starred', icon: Star },
              { id: 'archived', label: 'Archived', icon: Archive, isDisabled: true },
            ]}
            selected={view}
            onChange={setView}
            className="w-full"
            panelClassName="pt-3"
          >
            {(id) => <p className="t-body">{id === 'all' ? 'All' : 'Starred'} content</p>}
          </Tabs>
        </Demo>
      </ControlSection>
      <ControlSection
        control={components.PressableRow!}
        purpose="A row that opens a page or a sheet, picks an item from a list, or opens another site."
      >
        <PressableRowDemo />
      </ControlSection>
    </section>
  )
}

function PressableRowDemo() {
  const [picked, setPicked] = useState('first')
  return (
    <>
      <Group>
        <PressableRow chevron onPress={() => {}}>
          <span className="min-w-0 flex-1">Details</span>
        </PressableRow>
        <PressableRow href="https://example.com" className="text-primary font-medium">
          <span className="min-w-0 flex-1">Open the website</span>
        </PressableRow>
      </Group>
      <Group>
        <PressableList aria-label="Items" selectedId={picked}>
          {['first', 'second'].map((id) => (
            <PressableOption
              key={id}
              id={id}
              name={id === 'first' ? 'Item 1' : 'Item 2'}
              onPress={() => setPicked(id)}
            >
              <span className="min-w-0 flex-1">{id === 'first' ? 'Item 1' : 'Item 2'}</span>
            </PressableOption>
          ))}
        </PressableList>
      </Group>
    </>
  )
}

type Choice = 'small' | 'medium' | 'large'

export function ChoicesSection({ components }: { components: Record<string, { name: string }> }) {
  const [layout, setLayout] = useState('list')
  const [size, setSize] = useState<Choice>('medium')
  const [filters, setFilters] = useState(false)
  const [status, setStatus] = useState('active')
  const [tag, setTag] = useState(true)
  const [on, setOn] = useState(true)
  const [auto, setAuto] = useState(false)
  const [checked, setChecked] = useState([false, true])
  return (
    <section aria-labelledby="gallery-choices" className="flex flex-col gap-8">
      <h2 id="gallery-choices" className="t-heading">
        Choices
      </h2>
      <ControlSection
        control={components.SegmentedChoice!}
        purpose="Pick one value from 2 to 4 short options. The pill slides to the new option and the arrow keys move the selection."
      >
        <div className="flex items-center gap-3">
          <SegmentedChoice
            label="Layout"
            segments={[
              { id: 'list', label: 'List' },
              { id: 'grid', label: 'Grid' },
            ]}
            selected={layout}
            onChange={setLayout}
          />
          <Button variant="text" label="Reset" onPress={() => setLayout('list')} />
        </div>
        <SegmentedChoice
          label="Size"
          fill
          segments={[
            { id: 'small', label: 'Small' },
            { id: 'medium', label: 'Medium' },
            { id: 'large', label: 'Large' },
          ]}
          selected={size}
          onChange={setSize}
        />
      </ControlSection>
      <ControlSection
        control={components.Capsule!}
        purpose="A small capsule for filters, tags, and choices that wrap onto several lines."
      >
        <Demo label="Filter, menu, token, add, toggle">
          <Capsule label="Filters" onPress={() => {}}>
            <SlidersHorizontal className="size-3.5" aria-hidden />
            Filters
          </Capsule>
          <Capsule label="Status" onPress={() => {}}>
            Status
            <ChevronDown className="size-3.5 opacity-60" aria-hidden />
          </Capsule>
          <Capsule label="Tag: Red" set onRemove={() => {}} removeLabel="Remove Tag: Red" />
          <Capsule label="Add" onPress={() => {}}>
            <Plus className="size-3.5" aria-hidden />
            Add
          </Capsule>
          <Capsule label="Filtered" isSelected={filters} onChange={setFilters} />
          <Capsule label="Disabled" isDisabled />
        </Demo>
        <Demo label="Status">
          {(
            [
              ['active', 'Active', 'border-status-known'],
              ['paused', 'Paused', 'border-status-learning'],
              ['draft', 'Draft', 'border-status-unknown'],
            ] as const
          ).map(([id, name, dot]) => (
            <Capsule
              key={id}
              label={name}
              isSelected={status === id}
              onChange={() => setStatus(id)}
            >
              <span aria-hidden className={`size-2.5 rounded-full border-2 ${dot}`} />
              {name}
            </Capsule>
          ))}
          <Capsule label="Tag" isSelected={tag} onChange={setTag} />
        </Demo>
      </ControlSection>
      <ControlSection
        control={components.Switch!}
        purpose="A setting that is on or off and takes effect at once. At the end of a row, with its label at the start."
      >
        <Group>
          <Switch label="Notifications" isSelected={on} onChange={setOn} />
          <Switch
            label="Auto-save"
            description="Saves a copy after every change."
            isSelected={auto}
            onChange={setAuto}
          />
        </Group>
      </ControlSection>
      <ControlSection
        control={components.Checkbox!}
        purpose="Select items in a list to act on them together. Not for settings; that is a Switch."
      >
        <div className="flex items-center gap-3">
          {checked.map((isSelected, index) => (
            <Checkbox
              key={index}
              label={`Item ${index + 1}`}
              isSelected={isSelected}
              onChange={(next) =>
                setChecked((current) => current.map((value, at) => (at === index ? next : value)))
              }
            />
          ))}
        </div>
      </ControlSection>
    </section>
  )
}

export function ValuesSection({ components }: { components: Record<string, { name: string }> }) {
  const [quantity, setQuantity] = useState(2)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(10)
  const [volume, setVolume] = useState(65)
  const [balance, setBalance] = useState(-8)
  const [range, setRange] = useState<[number, number]>([0.25, 0.7])
  const [zoom, setZoom] = useState(150)
  const signed = (value: number) => (value > 0 ? `+${value}` : String(value))
  return (
    <section aria-labelledby="gallery-values" className="flex flex-col gap-8">
      <h2 id="gallery-values" className="t-heading">
        Values
      </h2>
      <ControlSection
        control={components.Stepper!}
        purpose="A number changed one step at a time. At a limit that half dims but keeps focus; pressing it anyway shakes the block."
      >
        <div className="flex items-center justify-between gap-3">
          <span className="t-secondary">Quantity</span>
          <Stepper
            label="Quantity"
            value={quantity}
            min={0}
            max={10}
            format={String}
            decrementLabel="Decrease quantity"
            incrementLabel="Increase quantity"
            onChange={setQuantity}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="t-secondary">Offset</span>
          <Stepper
            label="Offset"
            value={offset}
            min={-12}
            max={12}
            format={signed}
            decrementLabel="Decrease offset"
            incrementLabel="Increase offset"
            onChange={setOffset}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="t-secondary">At its limit</span>
          <Stepper
            label="Limit"
            value={limit}
            min={0}
            max={10}
            format={String}
            decrementLabel="Decrease limit"
            incrementLabel="Increase limit"
            onChange={setLimit}
          />
        </div>
      </ControlSection>
      <ControlSection
        control={components.Slider!}
        purpose="A value dragged across a range, with a stepper above for single steps. Dragging near the default value snaps to it."
      >
        <Slider
          label="Volume"
          value={volume}
          min={0}
          max={100}
          step={5}
          detent={50}
          format={(value) => `${value}%`}
          decrementLabel="Lower volume"
          incrementLabel="Raise volume"
          onChange={setVolume}
        />
        <Slider
          label="Balance"
          value={balance}
          min={-50}
          max={50}
          step={1}
          detent={0}
          format={signed}
          decrementLabel="Shift left"
          incrementLabel="Shift right"
          onChange={setBalance}
        />
      </ControlSection>
      <ControlSection
        control={components.RangeHandles!}
        purpose="The start and end of a span. Drag a handle to move one end, or drag inside the span to move both."
      >
        <div className="bg-field relative h-12 rounded-sm">
          <RangeHandles
            start={range[0]}
            end={range[1]}
            minSpan={0.05}
            moveSpan
            color={1}
            className="h-full"
            startLabel="Range start"
            endLabel="Range end"
            step={0.05}
            largeStep={0.2}
            onChange={(start, end) => setRange([start, end])}
          />
        </div>
      </ControlSection>
      <ControlSection
        control={components.ToolPopover!}
        purpose="A tool's name and current value in a toolbar, which opens the tool's controls in a popover under it. A value away from its default takes the accent."
      >
        <div className="flex flex-wrap justify-center gap-2">
          <ToolPopover icon={Volume2} label="Volume" value={`${volume}%`} changed={volume !== 65}>
            <Slider
              label="Volume"
              value={volume}
              min={0}
              max={100}
              step={5}
              detent={50}
              format={(value) => `${value}%`}
              decrementLabel="Lower volume"
              incrementLabel="Raise volume"
              onChange={setVolume}
            />
          </ToolPopover>
          <ToolPopover
            icon={Hash}
            label="Quantity"
            value={String(quantity)}
            changed={quantity !== 2}
          >
            <Stepper
              label="Quantity"
              value={quantity}
              min={0}
              max={10}
              format={String}
              decrementLabel="Decrease quantity"
              incrementLabel="Increase quantity"
              onChange={setQuantity}
            />
          </ToolPopover>
          <ToolPopover icon={ZoomIn} label="Zoom" value={`${zoom}%`} changed={zoom !== 100}>
            <Stepper
              label="Zoom"
              value={zoom}
              min={50}
              max={200}
              step={25}
              format={(value) => `${value}%`}
              decrementLabel="Zoom out"
              incrementLabel="Zoom in"
              onChange={setZoom}
            />
          </ToolPopover>
        </div>
      </ControlSection>
    </section>
  )
}

const CATEGORIES = [
  { id: 'general', label: 'General' },
  { id: 'work', label: 'Work' },
  { id: 'personal', label: 'Personal' },
]

export function FormsSection({ components }: { components: Record<string, { name: string }> }) {
  const [name, setName] = useState('Untitled')
  const [notes, setNotes] = useState('')
  const [category, setCategory] = useState<string | null>('general')
  const [folder, setFolder] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [members, setMembers] = useState(['Member 1', 'Member 2'])
  const [query, setQuery] = useState('')
  const [suggest, setSuggest] = useState('')
  return (
    <section aria-labelledby="gallery-forms" className="flex flex-col gap-8">
      <h2 id="gallery-forms" className="t-heading">
        Forms
      </h2>
      <ControlSection
        control={components.Group!}
        purpose="Only the card around rows. One row alone in a group and several rows sharing one are the same control."
      >
        <Group header="Details" footer="Shown on the overview.">
          <FieldRow label="Plan" value="Standard" />
          <FieldRow label="Owner" value="Sam" />
        </Group>
      </ControlSection>
      <ControlSection
        control={components.FieldRow!}
        purpose="A labeled row: the label leads, and the value or a control trails."
      >
        <Group>
          <FieldRow label="Storage" value="1.2 GB used" />
          <FieldRow label="Status">
            <span className="flex-1" />
            <Capsule label="Active" set />
          </FieldRow>
        </Group>
      </ControlSection>
      <ControlSection
        control={components.TextField!}
        purpose="A text row inside a group. Typed text stays at body size, and at least 16 on touch so the browser never zooms in."
      >
        <Group header="Details">
          <TextField label="Name" value={name} onChange={setName} />
          <TextField label="Description" value={notes} onChange={setNotes} placeholder="Not set" />
        </Group>
      </ControlSection>
      <ControlSection
        control={components.Picker!}
        purpose="A closed choice as a row. It opens a list on pointer and a sheet on touch."
      >
        <Group>
          <Picker label="Category" value={category} options={CATEGORIES} onChange={setCategory} />
          <Picker
            label="Folder"
            value={folder}
            emptyLabel="None"
            options={CATEGORIES}
            onChange={setFolder}
          />
          <Switch label="Enabled" isSelected={enabled} onChange={setEnabled} />
        </Group>
      </ControlSection>
      <ControlSection
        control={components.SuggestField!}
        purpose="A text row that offers matching suggestions as you type."
      >
        <Group>
          <SuggestField
            label="Group name"
            value={suggest}
            suggestions={['Backup', 'Members', 'Settings']}
            onChange={setSuggest}
          />
        </Group>
      </ControlSection>
      <ControlSection
        control={components.ButtonRow!}
        purpose="A description with a real Button at the end, so an action never looks like a field. On touch the button goes full width below the text."
      >
        <Group header="Backup">
          <ButtonRow
            description="Save a copy of everything to a file."
            button={{ label: 'Export', icon: Upload, onPress: () => {} }}
          />
        </Group>
        <Group header="Sync">
          <ButtonRow
            title="Synced"
            description="2 minutes ago"
            button={{ label: 'Sync all', icon: RefreshCw, onPress: () => wait(1400) }}
          />
          <ButtonRow
            title="Storage"
            description="1.2 GB used"
            button={{ label: 'Manage', onPress: () => {} }}
          />
        </Group>
        <Group header="Members">
          {members.map((member) => (
            <FieldRow key={member} label={member}>
              <span className="flex-1" />
              <IconButton
                icon={X}
                label={`Remove ${member}`}
                size="compact"
                onPress={() => setMembers((current) => current.filter((item) => item !== member))}
              />
            </FieldRow>
          ))}
        </Group>
        <div>
          <Button
            variant="text"
            icon={Plus}
            label="Add member"
            onPress={() => setMembers((current) => [...current, `Member ${current.length + 1}`])}
          />
        </div>
      </ControlSection>
      <ControlSection
        control={components.SearchField!}
        purpose="The only standalone text box: searching a list. A clear button appears when it has text."
      >
        <SearchField label="Search" value={query} onChange={setQuery} />
      </ControlSection>
      <ControlSection
        control={components.Menu!}
        purpose="Actions, or a single choice, opened from a button. A popover on pointer, an action sheet on touch."
      >
        <MenuDemo />
      </ControlSection>
    </section>
  )
}

const DELETE_ITEM: ConfirmOptions = {
  title: 'Delete "Example"?',
  message: 'This removes it for good.',
  action: DELETE,
}

const ARCHIVE_ITEM: ConfirmOptions = {
  title: 'Archive "Example"?',
  message: 'It leaves the list and stays in the archive.',
  action: 'Archive',
  tone: 'warning',
}

function MenuDemo() {
  const confirm = useConfirm()
  const [answer, setAnswer] = useState('')
  const [sort, setSort] = useState('name')
  const ask = async (options: ConfirmOptions) => {
    setAnswer((await confirm(options)) ? 'Confirmed' : 'Declined')
  }
  const choice = (id: string, label: string) => ({
    id,
    label,
    checked: sort === id,
    onAction: () => setSort(id),
  })
  const action = (id: string, label: string, icon: LucideIcon) => ({
    id,
    label,
    icon,
    onAction: () => {},
  })
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Menu
        label="More actions"
        trigger={<IconButton label="More actions" icon={Ellipsis} />}
        items={[
          action('edit', 'Edit', Pencil),
          action('duplicate', 'Duplicate', Copy),
          { ...action('archive', 'Archive', Archive), tone: 'warning' },
        ]}
        destructive={[action('delete', 'Delete', Trash2)]}
      />
      <Menu
        label="Sort by"
        choiceMode="single"
        trigger={<Button variant="secondary" label="Sort by" />}
        items={[choice('name', 'Name'), choice('date', 'Date'), choice('size', 'Size')]}
      />
      <Button variant="secondary" label="Confirm delete" onPress={() => void ask(DELETE_ITEM)} />
      <Button variant="secondary" label="Confirm caution" onPress={() => void ask(ARCHIVE_ITEM)} />
      <span className="t-secondary" role="status">
        {answer}
      </span>
    </div>
  )
}

type GallerySheet = 'part' | 'full' | 'locked'

export function SheetSection() {
  const [shown, setShown] = useState<GallerySheet | null>(null)
  const [title, setTitle] = useState('')
  const { show } = useToast()
  const close = () => setShown(null)
  const onOpenChange = (open: boolean) => {
    if (!open) close()
  }
  return (
    <section aria-labelledby="gallery-sheets" className="flex flex-col gap-3">
      <h2 id="gallery-sheets" className="t-heading">
        Sheets and toasts
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" label="Part-height sheet" onPress={() => setShown('part')} />
        <Button variant="secondary" label="Full-height sheet" onPress={() => setShown('full')} />
        <Button
          variant="secondary"
          label="Locked sheet"
          onPress={() => {
            setTitle('')
            setShown('locked')
          }}
        />
        <Button
          variant="secondary"
          label="Show toast"
          onPress={() => void show('Archived 3 items', () => {})}
        />
      </div>
      <Sheet isOpen={shown === 'part'} onOpenChange={onOpenChange} title="Sort items">
        <p className="t-body py-2">A part-height sheet drags up to full height.</p>
      </Sheet>
      <Sheet
        isOpen={shown === 'full'}
        onOpenChange={onOpenChange}
        title="Item details"
        height="full"
        primary={{ label: 'Done', onPress: close }}
      >
        {Array.from({ length: 40 }, (_, line) => (
          <p key={line} className="t-body py-2">
            Line {line + 1} of a long form that scrolls inside the sheet.
          </p>
        ))}
      </Sheet>
      <Sheet
        isOpen={shown === 'locked'}
        onOpenChange={onOpenChange}
        title="New item"
        locked
        primary={{ label: 'Save', onPress: close, isDisabled: title.trim() === '' }}
      >
        <label className="t-body flex flex-col gap-1 py-2">
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="bg-field rounded-(--radius) px-3 py-2 text-base"
          />
        </label>
      </Sheet>
    </section>
  )
}

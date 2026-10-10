import { ArrowUpDown, Ellipsis, Inbox, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { FILTERS, removeFilterLabel } from '../ui/filterCopy'
import { MORE_ACTIONS } from '../ui/menuCopy'
import { A_TO_Z, SORT, SORT_BY, Z_TO_A } from '../ui/sortCopy'
import { KeyCap } from '../features/keyboard/KeyCap'
import { useStampedDensity } from '../platform/density'
import { Button, type ButtonVariant } from '../ui/Button'
import { Capsule } from '../ui/Capsule'
import { DELETE, useConfirm, type ConfirmOptions } from '../ui/Confirm'
import { EmptyState } from '../ui/EmptyState'
import { FilterRow } from '../ui/FilterRow'
import { ListHeader } from '../ui/ListHeader'
import { KeyPill } from '../ui/KeyPill'
import { Menu } from '../ui/Menu'
import { Row } from '../ui/Row'
import { RowList } from '../ui/RowList'
import { Sheet } from '../ui/Sheet'
import { StatusGlyph } from '../ui/StatusGlyph'
import { UNDO, useToast } from '../ui/Toast'

const DENSITIES = [
  ['touch', 'Touch'],
  ['pointer', 'Pointer'],
] as const

const VARIANTS: readonly ButtonVariant[] = ['primary', 'plain', 'tinted', 'destructive']

const TYPE_ROLES = [
  ['t-page-title', 'Page title'],
  ['t-screen-title', 'Screen title'],
  ['t-heading', 'Heading'],
  ['t-body', 'Body'],
  ['t-secondary', 'Secondary'],
  ['t-caption', 'Caption'],
  ['t-timer', 'Timer'],
  ['t-lyrics', 'Lyrics'],
] as const

const KIT_ACTIONS = [
  { id: 'edit', label: 'Edit', icon: Pencil, onAction: () => {} },
  { id: 'delete', label: 'Delete', icon: Trash2, tone: 'danger' as const, onAction: () => {} },
]

const DELETE_JOY: ConfirmOptions = {
  title: 'Delete "Soldier\'s Joy"?',
  message: 'This removes its links and list entries.',
  action: DELETE,
}

const ARCHIVE_JOY: ConfirmOptions = {
  title: 'Archive "Soldier\'s Joy"?',
  message: 'It leaves the catalog and stays in your archive.',
  action: 'Archive',
  tone: 'warning',
}

function MenuSection() {
  const confirm = useConfirm()
  const [answer, setAnswer] = useState('')
  const ask = async (options: ConfirmOptions) => {
    const ok = await confirm(options)
    setAnswer(ok ? 'Confirmed' : 'Declined')
  }
  return (
    <section aria-labelledby="kit-menus">
      <h2 id="kit-menus" className="t-heading">
        Menus
      </h2>
      <div className="flex flex-wrap items-center gap-3 py-2">
        <Menu
          label={MORE_ACTIONS}
          trigger={<Button label={MORE_ACTIONS} iconOnly icon={Ellipsis} />}
          items={[
            { id: 'edit', label: 'Edit', icon: Pencil, onAction: () => {} },
            {
              id: 'archive',
              label: 'Archive',
              icon: TriangleAlert,
              tone: 'warning',
              onAction: () => {},
            },
          ]}
          destructive={[{ id: 'delete', label: 'Delete', icon: Trash2, onAction: () => {} }]}
        />
        <Button variant="tinted" label="Confirm delete" onPress={() => void ask(DELETE_JOY)} />
        <Button variant="tinted" label="Confirm caution" onPress={() => void ask(ARCHIVE_JOY)} />
        <span className="t-secondary" role="status">
          {answer}
        </span>
      </div>
    </section>
  )
}

const FILTER_LABELS = ['Key: Any', 'Type: Any', FILTERS, 'Genre: old-time', 'Composer: Traditional']

function ChromeSection() {
  const { show } = useToast()
  const [ascending, setAscending] = useState(true)
  return (
    <section aria-labelledby="kit-chrome">
      <h2 id="kit-chrome" className="t-heading">
        List chrome
      </h2>
      <ListHeader
        count="11 of 84 tunes"
        sort={{
          label: 'Title',
          ascending,
          spoken: `${SORT_BY} Title, ${ascending ? A_TO_Z : Z_TO_A}`,
          menu: (trigger) => (
            <Menu
              label={SORT}
              trigger={trigger}
              items={[
                {
                  id: 'reverse',
                  label: 'Reverse order',
                  icon: ArrowUpDown,
                  onAction: () => setAscending((value) => !value),
                },
              ]}
            />
          ),
        }}
      />
      <FilterRow label={FILTERS}>
        {FILTER_LABELS.map((name) => (
          <Capsule key={name} label={name} />
        ))}
      </FilterRow>
      <div className="flex flex-wrap items-center gap-3 py-2">
        <Button
          variant="tinted"
          label="Show toast"
          onPress={() => show('Archived 3 tunes', () => {})}
        />
        <span className="t-secondary">{UNDO} is on the toast.</span>
      </div>
      <div className="h-56">
        <EmptyState
          icon={Inbox}
          title="No tunes yet"
          hint="Add a tune to start your repertoire."
          action={<Button variant="primary" icon={Plus} label="Add tune" />}
        />
      </div>
    </section>
  )
}

type KitSheet = 'part' | 'full' | 'locked'

function SheetSection() {
  const [shown, setShown] = useState<KitSheet | null>(null)
  const [title, setTitle] = useState('')
  const close = () => setShown(null)
  const onOpenChange = (open: boolean) => {
    if (!open) close()
  }
  return (
    <section aria-labelledby="kit-sheets">
      <h2 id="kit-sheets" className="t-heading">
        Sheets
      </h2>
      <div className="flex flex-wrap items-center gap-3 py-2">
        <Button variant="tinted" label="Part-height sheet" onPress={() => setShown('part')} />
        <Button variant="tinted" label="Full-height sheet" onPress={() => setShown('full')} />
        <Button
          variant="tinted"
          label="Locked sheet"
          onPress={() => {
            setTitle('')
            setShown('locked')
          }}
        />
      </div>
      <Sheet isOpen={shown === 'part'} onOpenChange={onOpenChange} title="Sort tunes">
        <p className="t-body py-2">A part-height sheet drags up to full height.</p>
      </Sheet>
      <Sheet
        isOpen={shown === 'full'}
        onOpenChange={onOpenChange}
        title="Tune details"
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
        title="New tune"
        locked
        primary={{ label: 'Save', onPress: close, isDisabled: title.trim() === '' }}
      >
        <label className="t-body flex flex-col gap-1 py-2">
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="bg-fill rounded-(--radius-row) px-3 py-2 text-base"
          />
        </label>
      </Sheet>
    </section>
  )
}

export function KitPage() {
  const density = useStampedDensity()
  return (
    <div className="px-4 pb-16">
      <h1 className="t-page-title pt-6 pb-4">Kit</h1>
      <main className="flex flex-col gap-8">
        <section aria-labelledby="kit-type">
          <h2 id="kit-type" className="t-heading">
            Type
          </h2>
          {TYPE_ROLES.map(([className, name]) => (
            <p key={className} className={className}>
              {name}
            </p>
          ))}
          <p className="t-body t-num">11 of 84 tunes</p>
        </section>
        <section aria-labelledby="kit-buttons">
          <h2 id="kit-buttons" className="t-heading">
            Buttons
          </h2>
          <div role="group" aria-label="Density" className="flex items-center gap-2 py-2">
            <span className="t-secondary">Density:</span>
            {DENSITIES.map(([value, name]) => (
              <Capsule
                key={value}
                label={name}
                set={density === value}
                onPress={() => {
                  document.documentElement.dataset.density = value
                }}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 py-2">
            {VARIANTS.map((variant) => (
              <Button key={variant} variant={variant} label={variant} />
            ))}
            <Button icon={Plus} label="Add tune" iconOnly />
            <Capsule label="Key: Any" />
            <Capsule label="Key: D" set />
            <Capsule label="Reel" set onRemove={() => {}} removeLabel={removeFilterLabel('Reel')} />
          </div>
        </section>
        <section aria-labelledby="kit-music">
          <h2 id="kit-music" className="t-heading">
            Status and keys
          </h2>
          <div className="flex flex-wrap items-center gap-3 py-2">
            {['known', 'learning', 'want_to_learn'].map((status) => (
              <StatusGlyph key={status} status={status} />
            ))}
            {['known', 'learning', 'want_to_learn'].map((status) => (
              <StatusGlyph key={`${status}-labelled`} status={status} labelled />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 py-2">
            {['C', 'Eb', 'F#', 'Bb', 'Am'].map((key) => (
              <KeyPill key={key} value={key} />
            ))}
            <KeyPill value="D" chosen />
            <KeyPill value="Am" chosen />
            <KeyPill value="G" compact suffix=" mix" />
          </div>
          <div className="flex items-center gap-1 py-2">
            <KeyCap keyName="Meta" />
            <KeyCap keyName="K" />
          </div>
        </section>
        <section aria-labelledby="kit-rows">
          <h2 id="kit-rows" className="t-heading">
            Rows
          </h2>
          <RowList label="Catalog tunes" selectionMode="multiple">
            <Row
              id="ladies"
              textValue="The Ladies of Carrick"
              title="The Ladies of Carrick on the Long Road Home to Kilkenny"
              leading={<StatusGlyph status="learning" />}
              detail="Violin Cross A (AEAE), capo 2"
              trailing={<KeyPill value="A" compact />}
              actions={KIT_ACTIONS}
            />
            <Row
              id="joy"
              textValue="Soldier's Joy"
              title="Soldier's Joy"
              leading={<StatusGlyph status="known" />}
              detail="Standard tuning"
              trailing={<KeyPill value="D" compact />}
              actions={KIT_ACTIONS}
            />
            <Row
              id="old"
              textValue="Old Joe Clark"
              title="Old Joe Clark"
              leading={<StatusGlyph status="want_to_learn" />}
              trailing={<KeyPill value="A" compact />}
              actions={KIT_ACTIONS}
              dimmed
            />
          </RowList>
          <RowList label="Recordings">
            <Row
              id="take"
              textValue="Take 3"
              title="Take 3"
              detail="Today at 9:41 AM, 2:14"
              actions={KIT_ACTIONS}
            />
          </RowList>
        </section>
        <SheetSection />
        <MenuSection />
        <ChromeSection />
      </main>
    </div>
  )
}

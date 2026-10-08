import { useId } from 'react'
import { keyPlatform, type KeyPlatform } from '../../platform/keyPlatform'
import { DONE } from '../../ui/confirmCopy'
import {
  isSequence,
  SHORTCUTS,
  SHORTCUTS_TITLE,
  type Shortcut,
  type ShortcutGroup,
} from '../../ui/keymap'
import { Sheet } from '../../ui/Sheet'
import { KeyCap } from './KeyCap'
import { useShortcutSheet } from './shortcutSheetLauncher'

/** Between the keys of a sequence, which are pressed one after another rather than together. */
export const THEN = 'then'

const GROUPS = [...new Set(SHORTCUTS.map((shortcut) => shortcut.group))]

/** Every shortcut from the keymap, by group, opened by `?` and from Quick Find. */
export function ShortcutSheet({ platform = keyPlatform() }: { platform?: KeyPlatform }) {
  const { shown, close } = useShortcutSheet()
  return (
    <Sheet
      isOpen={shown}
      onOpenChange={(open) => {
        if (!open) close()
      }}
      title={SHORTCUTS_TITLE}
      height="part"
      leading={null}
      primary={{ label: DONE, onPress: close }}
    >
      <div className="flex flex-col gap-6 pb-2">
        {GROUPS.map((group) => (
          <ShortcutGroupSection key={group} group={group} platform={platform} />
        ))}
      </div>
    </Sheet>
  )
}

function ShortcutGroupSection({
  group,
  platform,
}: {
  group: ShortcutGroup
  platform: KeyPlatform
}) {
  const heading = useId()
  return (
    <section aria-labelledby={heading}>
      <h3 id={heading} className="t-heading text-ink-2 pb-1">
        {group}
      </h3>
      <ul>
        {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
          <ShortcutRow key={shortcut.id} shortcut={shortcut} platform={platform} />
        ))}
      </ul>
    </section>
  )
}

function ShortcutRow({ shortcut, platform }: { shortcut: Shortcut; platform: KeyPlatform }) {
  return (
    <li className="flex min-h-10 items-center justify-between gap-4">
      <span className="t-body">{shortcut.label}</span>
      <ShortcutKeys shortcut={shortcut} platform={platform} />
    </li>
  )
}

/** A shortcut's key caps, with `then` between the keys of a sequence. */
export function ShortcutKeys({
  shortcut,
  platform = keyPlatform(),
}: {
  shortcut: Shortcut
  platform?: KeyPlatform
}) {
  const sequence = isSequence(shortcut)
  return (
    <span className="text-ink-2 t-caption flex shrink-0 items-center gap-1">
      {shortcut.keys.map((key, index) => (
        <span key={index} className="flex items-center gap-1">
          {sequence && index > 0 && <span>{THEN}</span>}
          <KeyCap keyName={key} platform={platform} />
        </span>
      ))}
    </span>
  )
}

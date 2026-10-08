import { ListBoxItem, Text } from 'react-aria-components'
import type { QuickFindItem } from './quickFindResults'
import { ARCHIVED } from '../tune/archiveLabels'
import { shortcutById } from '../keyboard/keymap'
import { ShortcutKeys } from '../keyboard/ShortcutSheet'

/** The second line under a result, when it says something the title does not. */
function detailOf(item: QuickFindItem): string | null {
  switch (item.kind) {
    case 'command':
      return item.command.description ?? null
    case 'tune':
      return item.archived ? ARCHIVED : null
    case 'list':
      return null
    case 'recording':
      // A recording without a label already takes its tune's title as its own.
      return item.tuneTitle !== null && item.tuneTitle !== item.title ? item.tuneTitle : null
  }
}

/** One Quick Find result: its title, a second line when it has one, and a command's keys. */
export function ResultRow({ item }: { item: QuickFindItem }) {
  const detail = detailOf(item)
  const shortcut =
    item.kind === 'command' && item.command.shortcut
      ? shortcutById(item.command.shortcut)
      : undefined
  return (
    <ListBoxItem
      id={item.key}
      textValue={item.title}
      className="t-body data-[focused]:bg-fill flex min-h-(--target) cursor-default items-center gap-3 rounded-(--radius-row) px-3 py-1 outline-none"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <Text slot="label" className="truncate">
          {item.title}
        </Text>
        {detail && (
          <Text slot="description" className="t-secondary text-ink-2 truncate">
            {detail}
          </Text>
        )}
      </span>
      {shortcut && <ShortcutKeys shortcut={shortcut} />}
    </ListBoxItem>
  )
}

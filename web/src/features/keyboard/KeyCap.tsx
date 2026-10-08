import { keyLabel, keySpoken } from './keymap'
import { keyPlatform, type KeyPlatform } from '../../platform/keyPlatform'

/**
 * One key as a small bordered cap on the ground, showing the keymap's label. A cap that shows a
 * glyph or an abbreviation, such as ⌘ or Esc, is spoken by the key's name instead.
 */
export function KeyCap({
  keyName,
  platform = keyPlatform(),
}: {
  /** A key as the keymap table writes it, such as `Meta` or `K`. */
  keyName: string
  platform?: KeyPlatform
}) {
  const shown = keyLabel(keyName, platform)
  const spoken = keySpoken(keyName, platform)
  return (
    <kbd className="border-hairline bg-ground text-ink t-caption t-num inline-flex h-[1.75em] min-w-[1.75em] items-center justify-center rounded-[0.35em] border px-[0.45em] font-sans">
      {shown === spoken ? (
        shown
      ) : (
        <>
          <span aria-hidden>{shown}</span>
          <span className="sr-only">{spoken}</span>
        </>
      )}
    </kbd>
  )
}

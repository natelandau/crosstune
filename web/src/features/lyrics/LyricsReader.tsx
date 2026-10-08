import { AArrowDown, AArrowUp, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Dialog, Modal, ModalOverlay } from 'react-aria-components'
import { LARGER_TEXT, lyricsTitle, SMALLER_TEXT } from './lyricsCopy'
import { useLyricsReader, type LyricsReader as Reader } from './useLyricsReader'
import { EDIT_LYRICS } from '../tune/tuneScreenCopy'
import { CLOSE } from '../../ui/confirmCopy'
import { DURATION, EASE } from '../../theme/motion'
import { Button } from '../../ui/Button'
import { useOverlayClaim } from '../../ui/overlayClaim'
import { LyricsEditor } from './LyricsEditor'
import { Verses } from './Verses'

const MotionModalOverlay = motion.create(ModalOverlay)

/**
 * A tune's words at reading distance, over the whole window on the app's ground. It carries no
 * control but the size, the editor, and the way out. Escape closes it and focus returns to the
 * control that opened it. The page passes the tune it already reads, and closes the reader by
 * `isOpen` once that tune is gone.
 */
export function LyricsReader({
  tuneId,
  title,
  lyrics,
  isOpen,
  onOpenChange,
}: {
  tuneId: string
  title: string
  lyrics: string | null
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}) {
  // The words and name last shown, kept through the fade out, since a tune that has gone
  // closes the reader with an empty title and no words.
  const [shown, setShown] = useState({ title, lyrics })
  if (isOpen && (shown.title !== title || shown.lyrics !== lyrics)) setShown({ title, lyrics })
  const reader = useLyricsReader({ open: isOpen, tuneId, lyrics: shown.lyrics })
  return (
    <AnimatePresence>
      {isOpen && (
        <ReaderSurface
          title={shown.title}
          lyrics={shown.lyrics}
          reader={reader}
          onClose={() => onOpenChange(false)}
        />
      )}
    </AnimatePresence>
  )
}

function ReaderSurface({
  title,
  lyrics,
  reader,
  onClose,
}: {
  title: string
  lyrics: string | null
  reader: Reader
  onClose: () => void
}) {
  useOverlayClaim({ coversShell: true, close: onClose })
  return (
    // A fade only, under reduced motion too: nothing moves, so there is nothing to reduce.
    <MotionModalOverlay
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      className="bg-ground fixed inset-0 z-50"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.base, ease: EASE }}
    >
      <Modal className="h-full w-full">
        <Dialog
          aria-label={lyricsTitle(title)}
          className="flex h-full flex-col pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] outline-none"
        >
          <header className="flex items-center gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
            <h2 className="t-heading min-w-0 flex-1 px-2 break-words">{title}</h2>
            <Button
              icon={AArrowDown}
              label={SMALLER_TEXT}
              iconOnly
              // aria-disabled rather than disabled: a disabled control cannot hold focus, so a
              // keyboard reaching the end of the scale would be dropped to the document.
              aria-disabled={reader.atSmallest}
              onPress={reader.smaller}
            />
            <Button
              icon={AArrowUp}
              label={LARGER_TEXT}
              iconOnly
              aria-disabled={reader.atLargest}
              onPress={reader.larger}
            />
            <Button icon={X} label={CLOSE} iconOnly onPress={onClose} />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* The tail lets the last verse scroll to the middle of the screen, which is where
                a propped phone is read, rather than sitting against the bottom edge. */}
            <div className="px-4 pt-4 pb-[45vh]">
              {/* The measure is in the words' own size, so it widens with each step. */}
              <Verses verses={reader.verses} step={reader.step} className="mx-auto max-w-[38ch]">
                {/* After the words, not in the header: a musician who has read to the end is
                    already here, and a scroll mid-tune never reaches it. */}
                <div className="pt-8">
                  <Button
                    variant="quiet"
                    label={EDIT_LYRICS}
                    fullWidth
                    onPress={() => reader.setEditing(true)}
                  />
                </div>
              </Verses>
            </div>
          </div>
          <p role="status" className="sr-only">
            {reader.announced}
          </p>
          <LyricsEditor
            isOpen={reader.editing}
            onOpenChange={reader.setEditing}
            value={lyrics ?? ''}
            onSave={reader.save}
            error={reader.error}
            pending={reader.pending}
          />
        </Dialog>
      </Modal>
    </MotionModalOverlay>
  )
}

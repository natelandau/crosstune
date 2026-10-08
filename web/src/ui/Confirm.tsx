import { AnimatePresence } from 'motion/react'
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Dialog, Heading } from 'react-aria-components'
import { CANCEL } from './confirmCopy'
import { useStampedDensity } from '../platform/density'
import { Button, type ButtonVariant } from './Button'
import { PointerOverlay } from './PointerOverlay'
import { Sheet } from './Sheet'

export { CANCEL, DELETE } from './confirmCopy'

export interface ConfirmOptions {
  title: string
  message: string
  /** The confirming button's label, a bare verb: Delete, Remove. */
  action: string
  /** `danger` for a destructive action, `warning` for a cautionary one. */
  tone?: 'danger' | 'warning'
  /** Aborting withdraws the question, answering no, if it is still the one on screen. */
  signal?: AbortSignal
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

type Token = object

interface Owner {
  token: Token
  settle: (ok: boolean) => void
}

interface ConfirmApi {
  ask: (options: ConfirmOptions, token: Token) => Promise<boolean>
  /** Answers no and closes the dialog if `token` still owns it. */
  withdraw: (token: Token) => void
}

const ConfirmContext = createContext<ConfirmApi | null>(null)

const ACTION_VARIANT = {
  danger: 'destructive',
  warning: 'warning',
} as const satisfies Record<NonNullable<ConfirmOptions['tone']>, ButtonVariant>

/**
 * Returns a function that asks a destructive question and resolves true only when the named
 * action is chosen; Cancel, Escape, and the backdrop resolve false.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm(): Confirm {
  const api = useContext(ConfirmContext)
  if (!api) throw new Error('useConfirm needs a ConfirmProvider')
  const { ask, withdraw } = api
  // One token per hook instance, so a declined repeat call still withdraws the open question.
  const [token] = useState<Token>(() => ({}))
  // A question whose asker has gone has no target left to act on, so it answers no.
  useEffect(
    () => () => {
      withdraw(token)
    },
    [withdraw, token],
  )
  return useCallback(
    (options) => {
      return ask(options, token)
    },
    [ask, token],
  )
}

function PointerAlert({
  options,
  onAnswer,
}: {
  options: ConfirmOptions
  onAnswer: (ok: boolean) => void
}) {
  const { title, message, action, tone = 'danger' } = options
  const messageId = useId()
  return (
    <PointerOverlay
      onOpenChange={(open) => {
        if (!open) onAnswer(false)
      }}
      className="bg-ground w-80 max-w-full rounded-(--radius-surface) p-4 shadow-(--shadow-float)"
    >
      <Dialog role="alertdialog" aria-describedby={messageId} className="flex flex-col gap-3">
        <Heading slot="title" className="t-heading">
          {title}
        </Heading>
        <p id={messageId} className="t-body text-ink-2">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          {/* Focus starts on the safe choice. */}
          <Button label={CANCEL} autoFocus onPress={() => onAnswer(false)} />
          <Button variant={ACTION_VARIANT[tone]} label={action} onPress={() => onAnswer(true)} />
        </div>
      </Dialog>
    </PointerOverlay>
  )
}

/** Owns the one confirmation on screen, as an action sheet on touch and an alert on pointer. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const density = useStampedDensity()
  const [shown, setShown] = useState<{ options: ConfirmOptions; open: boolean } | null>(null)
  const owner = useRef<Owner | null>(null)

  const ask = useCallback<ConfirmApi['ask']>((options, token) => {
    // A second call before the first is answered is one impatient double press, not a second
    // question, so it declines at once instead of stacking another dialog.
    if (owner.current || options.signal?.aborted) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      const mine: Owner = {
        token,
        settle: (ok) => {
          options.signal?.removeEventListener('abort', withdrawMine)
          owner.current = null
          setShown((current) => current && { ...current, open: false })
          resolve(ok)
        },
      }
      // Compared by identity, so a later question from the same asker is never closed by an
      // earlier question's signal.
      function withdrawMine() {
        if (owner.current === mine) mine.settle(false)
      }
      options.signal?.addEventListener('abort', withdrawMine, { once: true })
      owner.current = mine
      setShown({ options, open: true })
    })
  }, [])

  const withdraw = useCallback<ConfirmApi['withdraw']>((token) => {
    if (owner.current?.token === token) owner.current.settle(false)
  }, [])

  // A provider that goes takes its open question with it, answered no.
  useEffect(
    () => () => {
      owner.current?.settle(false)
    },
    [],
  )

  const messageId = useId()
  const api = useMemo(() => ({ ask, withdraw }), [ask, withdraw])
  const onAnswer = (ok: boolean) => owner.current?.settle(ok)
  const options = shown?.options

  return (
    <ConfirmContext value={api}>
      {children}
      {density === 'touch' ? (
        <Sheet
          isOpen={shown?.open ?? false}
          onOpenChange={(open) => {
            if (!open) onAnswer(false)
          }}
          title={options?.title ?? ''}
          describedBy={messageId}
        >
          {options && (
            <div className="flex flex-col gap-3 pb-2">
              <p id={messageId} className="t-body text-ink-2 text-center">
                {options.message}
              </p>
              <Button
                variant={ACTION_VARIANT[options.tone ?? 'danger']}
                label={options.action}
                fullWidth
                onPress={() => onAnswer(true)}
              />
            </div>
          )}
        </Sheet>
      ) : (
        <AnimatePresence>
          {shown?.open && <PointerAlert key="alert" options={shown.options} onAnswer={onAnswer} />}
        </AnimatePresence>
      )}
    </ConfirmContext>
  )
}

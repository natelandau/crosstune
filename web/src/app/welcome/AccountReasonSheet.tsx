import { WHY_ACCOUNT_BODY, WHY_ACCOUNT_DONE, WHY_ACCOUNT_TITLE } from '../../auth/links'
import { Sheet } from '../../ui/Sheet'

/** Why the app asks for an account: what it copies where, and what it costs. */
export function AccountReasonSheet({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={WHY_ACCOUNT_TITLE}
      height="fit"
      cancel={null}
      primaryLarge
      primary={{ label: WHY_ACCOUNT_DONE, onPress: () => onOpenChange(false) }}
    >
      <div className="flex flex-col gap-3 pt-2">
        {WHY_ACCOUNT_BODY.map((paragraph) => (
          <p key={paragraph} className="t-body m-0">
            {paragraph}
          </p>
        ))}
      </div>
    </Sheet>
  )
}

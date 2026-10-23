import { UserRound } from 'lucide-react'
import { useAuthSession } from '../auth/AuthContext'
import { DestinationLink } from './DestinationLink'
import { useFrame } from '../platform/frame'
import { destination } from './destinations'
import { initials } from './initials'
import { ACCOUNT_BUTTON } from './tabs'

const SETTINGS = destination('settings')

/**
 * The phone's way into Settings, which has no tab there: the account's initials in a disc at
 * the end of a root screen's title row, or a person when the account has no name. It opens
 * Settings where it was left, as a page pushed over the tab. Split and wide keep Settings in the
 * sidebar, so there it renders nothing.
 */
export function AccountButton() {
  const frame = useFrame()
  const letters = initials(useAuthSession().name)
  if (frame !== 'phone') return null
  return (
    <DestinationLink
      to="settings"
      href={SETTINGS.root}
      current={false}
      label={ACCOUNT_BUTTON}
      className="group ms-auto flex size-(--target-control) shrink-0 items-center justify-center rounded-full"
    >
      <span
        aria-hidden
        className="bg-field text-ink t-caption group-hover:bg-tint-hover flex size-8 items-center justify-center rounded-full font-semibold transition-colors duration-(--dur-short) ease-(--ease)"
      >
        {letters ?? <UserRound className="size-5" aria-hidden />}
      </span>
    </DestinationLink>
  )
}

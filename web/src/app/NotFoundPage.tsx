import { SearchX } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { destination } from './destinations'

export const NOT_FOUND_TITLE = 'Page not found'
export const NOT_FOUND_HINT = 'Nothing in Crosstune lives at this address.'
export const OPEN_CATALOG = 'Open the catalog'

/** What an address no route knows shows, inside the shell so every destination stays in reach. */
export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <main aria-label={NOT_FOUND_TITLE} className="h-full">
      <EmptyState
        icon={SearchX}
        title={NOT_FOUND_TITLE}
        headingLevel={1}
        hint={NOT_FOUND_HINT}
        action={
          <Button
            variant="primary"
            label={OPEN_CATALOG}
            onPress={() => navigate(destination('catalog').root)}
          />
        }
      />
    </main>
  )
}

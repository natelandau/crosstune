import { Button } from '../../ui/Button'
import { RESET } from './panel'

/** Puts a panel's setting back to its default; dimmed while it is already there. */
export function ResetButton({ atDefault, onReset }: { atDefault: boolean; onReset: () => void }) {
  return <Button label={RESET} aria-disabled={atDefault} onPress={onReset} />
}

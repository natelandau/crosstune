import { page } from 'vitest/browser'
import {
  ON_PREMIUM,
  PREMIUM_PLAN_TITLE,
  PREMIUM_RECORDINGS_TITLE,
  PREMIUM_SCANS_TITLE,
} from '../features/plan/planCopy'

// The Plan sheet has no title of its own: its headline names it, and the headline follows the
// reason it opened for and the plan.
const HEADLINES = [PREMIUM_RECORDINGS_TITLE, PREMIUM_SCANS_TITLE, PREMIUM_PLAN_TITLE, ON_PREMIUM]
const NAME = new RegExp(
  `^(${HEADLINES.map((headline) => headline.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`,
)

/** The open Plan sheet, whichever headline names it. */
export const planSheet = () => page.getByRole('dialog', { name: NAME })

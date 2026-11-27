import { describeSharedCases, expectSameInstant, loadSharedCases } from '../test/sharedCases'
import { nextUpdatedAt } from './write'

interface Input {
  stored: string | null
  requested: string
}

const cases = loadSharedCases<Input, { stamped: string }>(
  import.meta.glob('../../../fixtures/write-timestamp/*.json', { eager: true, import: 'default' }),
  'web',
)

describeSharedCases('nextUpdatedAt shared cases', cases, 6, ({ input, expected }) => {
  expectSameInstant(nextUpdatedAt(input.stored ?? undefined, input.requested), expected.stamped)
})

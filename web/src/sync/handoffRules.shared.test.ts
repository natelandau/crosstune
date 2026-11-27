import { expect } from 'vitest'
import { describeSharedCases, loadSharedCases } from '../test/sharedCases'
import { handoffAttemptResult, handoffStatus, type StepOutcome } from './handoffRules'

interface StatusInput {
  check: 'status'
  handoff: { expires_at: string; attempts: number; refused: boolean; put_landed: boolean }
  now: string
}

interface AttemptInput {
  check: 'attempt'
  put: StepOutcome
  confirm: StepOutcome
}

type Input = StatusInput | AttemptInput
type Expected = { status?: string; result?: string }

const cases = loadSharedCases<Input, Expected>(
  import.meta.glob('../../../fixtures/upload-handoff/*.json', { eager: true, import: 'default' }),
  'web',
)

describeSharedCases('hand-off rules shared cases', cases, 17, ({ input, expected }) => {
  if (input.check === 'status') {
    const { handoff } = input
    const status = handoffStatus(
      {
        url: 'https://r2.example/put/rec-1',
        confirm_token: 'token',
        content_type: 'audio/mp4',
        ...handoff,
        expires_at: Date.parse(handoff.expires_at),
      },
      Date.parse(input.now),
    )
    expect(status).toBe(expected.status)
  } else {
    expect(handoffAttemptResult(input.put, input.confirm)).toBe(expected.result)
  }
})

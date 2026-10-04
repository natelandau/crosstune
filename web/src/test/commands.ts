import { commands } from 'vitest/browser'

declare module 'vitest/browser' {
  interface BrowserCommands {
    /** Answers every request matching `pattern` with an empty 204 until `unstubRequests`. */
    stubRequests: (pattern: string) => Promise<void>
    /** How many requests the stub for `pattern` has answered. */
    stubbedRequests: (pattern: string) => Promise<number>
    unstubRequests: (pattern: string) => Promise<void>
  }
}

export const { stubRequests, stubbedRequests, unstubRequests } = commands

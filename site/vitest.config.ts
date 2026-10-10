import { defineConfig } from 'vitest/config'
import { CLERK_JS_VERSION } from './clerkVersion.mjs'

export default defineConfig({
  define: { __CLERK_JS_VERSION__: JSON.stringify(CLERK_JS_VERSION) },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})

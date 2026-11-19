import { configDefaults, defineConfig } from 'vitest/config'

// The test recipe names a JUnit report file so gate-cache can record each test's result. The
// defaults stay first, since Vitest picks them for the environment, such as GitHub Actions.
const junitReport = process.env.JUNIT_REPORT

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    reporters: junitReport ? [...configDefaults.reporters, 'junit'] : configDefaults.reporters,
    outputFile: junitReport ? { junit: junitReport } : undefined,
  },
})

import { defineConfig, devices } from '@playwright/test'
import { e2eUserEmails } from './e2e/users'

try {
  process.loadEnvFile('.env')
} catch {
  // CI and fresh clones set the variables another way or skip e2e.
}

// Not the :5173 `just dev` serves, so the suite runs beside a dev session. The Clerk instance
// and every api/.env already name this origin as an authorized party.
const PORT = 4173

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: Math.max(1, e2eUserEmails().length),
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  reporter: process.env.CI ? [['list'], ['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // Page transitions and the swipe, hold, and drag gestures move between trace snapshots.
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm vite build && pnpm vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Never adopt a server someone else started: `just web::preview` serves this port with
    // the proxy pointed at the development API, and a suite that reused it would write its
    // fixtures into a database filled by hand. --strictPort makes that collision loud.
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    {
      name: 'phone',
      use: {
        ...devices['Pixel 7'],
        permissions: ['microphone'],
        launchOptions: {
          args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
        },
      },
      dependencies: ['setup'],
    },
  ],
})

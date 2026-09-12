import { defineConfig, devices } from '@playwright/test'

try {
  process.loadEnvFile('.env.local')
} catch {
  // CI and fresh clones set the variables another way or skip e2e.
}

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm vite build && pnpm vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'] },
      dependencies: ['setup'],
    },
  ],
})

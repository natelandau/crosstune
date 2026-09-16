import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default defineConfig((env) =>
  mergeConfig(
    viteConfig(env),
    defineConfig({
      test: {
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts'],
        include: [
          'src/**/*.test.{ts,tsx}',
          'worker/**/*.test.ts',
          'scripts/**/*.test.ts',
          'brand.test.ts',
          'pwa.test.ts',
          'headers.test.ts',
        ],
        restoreMocks: true,
      },
    }),
  ),
)

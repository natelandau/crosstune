import { clerkSetup } from '@clerk/testing/playwright'
import { test as setup } from '@playwright/test'

setup('obtain a clerk testing token', async () => {
  await clerkSetup({ publishableKey: process.env.VITE_CLERK_PUBLISHABLE_KEY })
})

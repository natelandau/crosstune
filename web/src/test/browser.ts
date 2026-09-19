import { setupIonicReact } from '@ionic/react'
import { cleanup, configure } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import '../app.css'
import { settleOverlays } from './overlays'

setupIonicReact()

// Ionic transitions and overlays settle in a few hundred milliseconds; findBy waits for them.
configure({ asyncUtilTimeout: 3000 })

afterEach(async () => {
  try {
    await settleOverlays()
  } finally {
    cleanup()
    sessionStorage.clear()
    localStorage.clear()
  }
})

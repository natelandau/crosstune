import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { dataProviders, type ProviderOptions } from './providers'

/** Renders a practice control inside practice, whose palette its colors come from, over the data
 * providers it reads. */
export function renderInPractice(ui: ReactElement, options: ProviderOptions): RenderResult {
  return render(<div data-practice>{ui}</div>, { wrapper: dataProviders(options) })
}

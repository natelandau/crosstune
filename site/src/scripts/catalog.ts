import {
  catalogCaption,
  choose,
  moreLabel,
  visibleTunes,
  NO_FILTER,
  type CatalogState,
  type Key,
  type Status,
} from '../demos/catalog'

export function mountCatalog(root: HTMLElement): void {
  const rows = [...root.querySelectorAll<HTMLElement>('[data-tune]')]
  const caption = root.querySelector<HTMLElement>('[data-caption]')!
  const more = root.querySelector<HTMLElement>('[data-more]')!
  const empty = root.querySelector<HTMLElement>('[data-empty]')!
  let state: CatalogState = NO_FILTER

  const press = (selector: string, on: (button: HTMLButtonElement) => boolean) => {
    for (const b of root.querySelectorAll<HTMLButtonElement>(selector)) {
      b.setAttribute('aria-pressed', String(on(b)))
    }
  }

  const render = () => {
    const { shown, more: hidden } = visibleTunes(state)
    const names = shown.map((t) => t.name)
    for (const li of rows) {
      const index = names.indexOf(li.dataset.tune!)
      li.hidden = index < 0
      li.style.order = String(index)
    }
    more.hidden = hidden === 0
    more.textContent = moreLabel(hidden)
    empty.hidden = shown.length > 0
    press('[data-key]', (b) => b.dataset.key === state.key)
    press('[data-status]', (b) => !state.list && (b.dataset.status || null) === state.status)
    press('[data-list]', (b) => b.dataset.list === state.list)
    caption.textContent = catalogCaption(state)
  }

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button')
    if (!button) return
    const { key, status, list, clear } = button.dataset
    if (clear !== undefined) {
      state = NO_FILTER
    } else if (key !== undefined) {
      state = choose(state, { key: state.key === key ? null : (key as Key) })
    } else if (status !== undefined) {
      state = choose(state, { status: (status || null) as Status | null })
    } else if (list !== undefined) {
      state = choose(state, { list: state.list === list ? null : list })
    } else return
    render()
  })

  root.querySelector<HTMLElement>('[data-controls]')!.hidden = false
  render()
}

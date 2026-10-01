import {
  BAND_CAPTION,
  BAND_RECORDING,
  linkCaption,
  LINKS,
  RECORD_LABEL,
  RECORD_PROMPT,
  RECORD_SAVED,
  RECORDING,
  TAKE_SECONDS,
  TUNE_NAME,
} from '../demos/record'

export function mountRecord(root: HTMLElement): void {
  const $ = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const capture = $('[data-panel="record"]')
  const playing = $('[data-panel="play"]')
  const frame = $('[data-frame]')
  const button = $<HTMLButtonElement>('[data-take]')
  const timer = $('[data-timer]')
  const bars = [...capture.querySelectorAll<HTMLElement>('.live span')]
  const take = $('[data-new-take]')
  const caption = $('[data-caption]')
  const nowGlyph = $('[data-now-glyph]')
  const nowTitle = $('[data-now-title]')
  const nowSource = $('[data-now-source]')
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const narrow = matchMedia('(max-width: 760px)')
  let running = false

  const select = (row: Element | null) => {
    for (const r of root.querySelectorAll('[data-row]')) r.removeAttribute('aria-current')
    row?.setAttribute('aria-current', 'true')
  }

  // Emptying the frame removes the player, which also stops whatever it was playing.
  const showRecorder = () => {
    frame.replaceChildren()
    playing.hidden = true
    capture.hidden = false
  }

  const showPlayer = (glyph: string, title: string, source: string, player: HTMLElement) => {
    nowGlyph.className = `glyph ${glyph}`
    nowTitle.textContent = title
    nowSource.textContent = source
    frame.replaceChildren(player)
    capture.hidden = true
    playing.hidden = false
    // Stacked at phone width, the player sits above the row that opened it.
    if (narrow.matches) {
      playing.scrollIntoView({ block: 'nearest', behavior: reduced.matches ? 'auto' : 'smooth' })
    }
  }

  const finish = () => {
    running = false
    capture.classList.remove('recording')
    button.setAttribute('aria-label', RECORD_LABEL)
    for (const bar of bars) bar.style.height = ''
    timer.textContent = `0:${String(TAKE_SECONDS).padStart(2, '0')}`
    // Re-inserting restarts the landing animation on a second take.
    take.hidden = true
    void take.offsetWidth
    take.hidden = false
    caption.textContent = RECORD_SAVED
  }

  button.addEventListener('click', () => {
    if (running) return
    if (reduced.matches) return finish()
    running = true
    capture.classList.add('recording')
    caption.textContent = RECORDING
    const start = performance.now()
    let level = 0.3
    let last = 0
    const step = (now: number) => {
      const elapsed = (now - start) / 1000
      if (elapsed >= TAKE_SECONDS) return finish()
      timer.textContent = `0:0${Math.floor(elapsed)}`
      if (now - last < 70) return void requestAnimationFrame(step)
      last = now
      // A drifting level with jitter reads as a melody rather than noise.
      level = Math.min(1, Math.max(0.15, level + (Math.random() - 0.5) * 0.25))
      const head = bars.shift()!
      head.style.height = `${Math.round((level * 0.7 + Math.random() * 0.3) * 100)}%`
      bars.push(head)
      head.parentElement!.append(head)
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })

  root.addEventListener('click', (event) => {
    const row = (event.target as Element).closest<HTMLElement>('[data-row]')
    if (!row) return
    const kind = row.dataset.row
    if (kind === 'take') {
      select(row)
      showRecorder()
      caption.textContent = RECORD_SAVED
    } else if (kind === 'band') {
      const audio = document.createElement('audio')
      audio.controls = true
      audio.src = BAND_RECORDING.src
      audio.setAttribute('aria-label', `${TUNE_NAME}, your recording`)
      select(row)
      showPlayer('mine', BAND_RECORDING.tune, BAND_RECORDING.source, audio)
      void audio.play().catch(() => {})
      caption.textContent = BAND_CAPTION
    } else if (kind === 'link') {
      event.preventDefault()
      const link = LINKS[Number(row.dataset.index)]
      const iframe = document.createElement('iframe')
      iframe.src = link.embed
      iframe.title = `${link.tune} on ${link.label}`
      iframe.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture'
      iframe.allowFullscreen = true
      if (link.height) iframe.height = String(link.height)
      else iframe.className = 'video'
      select(row)
      showPlayer(link.provider, link.tune, link.label, iframe)
      caption.textContent = linkCaption(link)
    }
  })

  $('[data-back]').addEventListener('click', () => {
    select(null)
    showRecorder()
    caption.textContent = RECORD_PROMPT
    button.focus()
  })

  capture.hidden = false
  caption.textContent = RECORD_PROMPT
}

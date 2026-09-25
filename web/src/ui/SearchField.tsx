import { IonSearchbar } from '@ionic/react'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'

export const CLEAR_SEARCH = 'Clear search'

export interface SearchFieldHandle {
  focus: () => void
  blur: () => void
}

/**
 * The search bar under a top-level screen's title. IonSearchbar names its own input "search
 * text" and its clear button "reset", and forwards no label to either, so this names them. The
 * host keeps Ionic's unnamed `search` landmark, which would otherwise repeat the input's name.
 */
export function SearchField({
  name,
  value,
  placeholder = name,
  onInput,
  onEnter,
  ref,
}: {
  /** The input's accessible name, such as "Search tunes". */
  name: string
  value: string
  placeholder?: string
  onInput: (value: string) => void
  onEnter?: () => void
  ref?: Ref<SearchFieldHandle>
}) {
  const searchbar = useRef<HTMLIonSearchbarElement>(null)

  useImperativeHandle(ref, () => ({
    focus: () => void searchbar.current?.setFocus(),
    blur: () => void searchbar.current?.getInputElement().then((input) => input.blur()),
  }))

  useEffect(() => {
    const element = searchbar.current
    void element?.getInputElement().then((input) => {
      input.setAttribute('aria-label', name)
      element.querySelector('.searchbar-clear-button')?.setAttribute('aria-label', CLEAR_SEARCH)
    })
  }, [name])

  return (
    <IonSearchbar
      ref={searchbar}
      value={value}
      placeholder={placeholder}
      enterkeyhint="search"
      showClearButton="focus"
      onIonInput={(event) => onInput(event.detail.value ?? '')}
      onKeyDown={(event) => {
        // Enter that confirms an input method's candidate is not a submit; Safari reports it
        // only through keyCode 229.
        if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return
        onEnter?.()
      }}
    />
  )
}

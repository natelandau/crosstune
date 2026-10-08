import { ArrowUpRight, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react'
import { Fragment, useRef } from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { useNavigate } from 'react-router'
import type { SearchGroup, SearchResult } from '../../api/types'
import type { Provider } from '../../api/vocabulary'
import { settingsPagePath } from '../settings/settingsPaths'
import { PROVIDER_LABELS } from '../../constants'
import {
  BACK,
  FIND_RECORDINGS,
  LINK,
  LINKED,
  linkedResult,
  linkResult,
  NO_RESULTS,
  PLAY,
  playResult,
  SEARCH_FOR,
  SEARCHING,
  searchOn,
  searchService,
  unavailableNow,
} from './findRecordingsCopy'
import { outcomeMessage, searchesInApp } from './serviceSearch'
import { resultKey, useFindRecordings } from './useFindRecordings'
import { embedFor } from '../player/embed'
import { EmbedFrame } from '../player/EmbedFrame'
import { MUSIC_SERVICES, NO_SERVICES } from '../settings/searchProviders'
import { DONE } from '../../ui/confirmCopy'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorLine } from '../../ui/ErrorLine'
import { FIELD_LABEL, FIELD_ROW } from '../../ui/form/FieldRow'
import { Group } from '../../ui/form/Group'
import { SearchField } from '../../ui/SearchField'
import { Sheet } from '../../ui/Sheet'
import { useEndOnClose } from '../../ui/useEndOnClose'

/**
 * Lists the musician's chosen music services and searches the one they tap: in place for a
 * service the app searches itself, where a result previews inline and links with a tap, or on
 * the service's own search page for any other. A full-height sheet.
 */
export function FindRecordingsSheet({
  tuneId,
  service,
  isOpen,
  onOpenChange,
}: {
  tuneId: string
  /**
   * Opens straight on this service's results and searches it, with no list to go back to, for
   * a musician who chose only this service. Read when the sheet opens.
   */
  service?: Provider
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const fieldRef = useRef<HTMLInputElement>(null)
  const find = useFindRecordings(isOpen ? tuneId : null, service, {
    onClose: () => onOpenChange(false),
    onOpenSettings: () => navigate(settingsPagePath('music-services')),
  })
  const { shown, search } = find

  useEndOnClose(find.closing, find.dismissed)

  const resultRows = (result: SearchResult) => {
    const key = resultKey(result)
    const embed = embedFor(result, { autoplay: true })
    const expanded = embed !== null && find.playing === key
    const linked = find.linked(result.url)
    return (
      <Fragment key={key}>
        <div className="flex min-h-(--target) items-center gap-1 ps-4 pe-1">
          <div className="min-w-0 flex-1 py-2">
            <p className="t-body">{result.title}</p>
            {result.subtitle && <p className="t-secondary text-ink-2">{result.subtitle}</p>}
          </div>
          {embed && (
            <Button
              label={PLAY}
              name={playResult(result.title)}
              aria-pressed={expanded}
              onPress={() => find.setPlaying(expanded ? null : key)}
            />
          )}
          <Button
            label={linked ? LINKED : LINK}
            name={linked ? linkedResult(result.title) : linkResult(result.title)}
            isDisabled={linked}
            onPress={() => find.claim(result)}
          />
        </div>
        {expanded && (
          <div className="px-4 pb-3">
            <EmbedFrame embed={embed} title={result.title} />
          </div>
        )}
      </Fragment>
    )
  }

  const searchOnRow = (group: SearchGroup) => (
    <a
      className={`${FIELD_ROW} text-slate`}
      href={group.search_url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className={`${FIELD_LABEL} flex-1`}>{searchOn(PROVIDER_LABELS[group.provider])}</span>
      <ArrowUpRight className="size-4 shrink-0" aria-hidden />
    </a>
  )

  /** One service's answer. Its own search page always closes the card, found or not. */
  const groupSection = (group: SearchGroup) => {
    const label = PROVIDER_LABELS[group.provider]
    // A status this client does not know offers the service's own search, as search_only does.
    if (group.status === 'unavailable') {
      return <Group footer={unavailableNow(label)}>{searchOnRow(group)}</Group>
    }
    if (group.status !== 'results') return <Group>{searchOnRow(group)}</Group>
    return (
      <Group footer={group.results.length === 0 ? NO_RESULTS : undefined}>
        {group.results.map(resultRows)}
        {searchOnRow(group)}
      </Group>
    )
  }

  const serviceRows = (chosen: ReadonlySet<Provider>) => (
    <Group error={find.notice ?? undefined}>
      {[...chosen].map((provider) => {
        const Trailing = searchesInApp(provider) ? ChevronRight : ArrowUpRight
        return (
          <AriaButton
            key={provider}
            onPress={() => find.pick(provider)}
            className={`${FIELD_ROW} cursor-default data-[pressed]:opacity-60`}
          >
            <span className={`${FIELD_LABEL} flex-1`}>
              {searchService(PROVIDER_LABELS[provider])}
            </span>
            <Trailing className="text-ink-2 size-4 shrink-0" aria-hidden />
          </AriaButton>
        )
      })}
    </Group>
  )

  const field = (
    <div className="pt-2">
      <SearchField
        ref={fieldRef}
        label={SEARCH_FOR}
        value={find.text}
        onChange={find.setQuery}
        onSubmit={() => {
          // Closes the on-screen keyboard, which would otherwise cover the results.
          fieldRef.current?.blur()
          find.submit()
        }}
      />
    </div>
  )

  const message =
    search.kind === 'idle' || search.kind === 'searching' ? null : outcomeMessage(search)
  const group =
    search.kind === 'ok' ? search.groups.find((answer) => answer.provider === shown) : undefined

  return (
    <Sheet
      isOpen={find.open}
      onOpenChange={(open) => {
        if (!open) find.close()
      }}
      title={shown === null ? FIND_RECORDINGS : PROVIDER_LABELS[shown]}
      height="full"
      // Nothing here waits to be kept, so there is nothing for Cancel to undo.
      leading={
        shown !== null && !find.direct
          ? { label: BACK, icon: ChevronLeft, onPress: find.back }
          : null
      }
      primary={{ label: DONE, onPress: find.close }}
    >
      {!find.ready || !find.providers ? null : find.providers.size === 0 ? (
        <EmptyState
          icon={SlidersHorizontal}
          title={NO_SERVICES}
          headingLevel={3}
          action={<Button label={MUSIC_SERVICES} onPress={find.openSettings} />}
        />
      ) : shown === null ? (
        <>
          {field}
          {serviceRows(find.providers)}
        </>
      ) : (
        <>
          {field}
          {/* Always present, so a screen reader hears the search start. */}
          <p role="status" className="t-secondary text-ink-2 px-4 pt-2">
            {/* An opening with nothing to search for starts no search, so it says nothing. */}
            {search.kind === 'searching' && find.text.trim() ? SEARCHING : null}
          </p>
          <ErrorLine error={message} place="field" />
          <ErrorLine error={find.error} place="field" />
          {group && groupSection(group)}
        </>
      )}
    </Sheet>
  )
}

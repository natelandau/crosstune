import { MapPin } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PLACE_LIMITS } from '../../../api/vocabulary'
import { ColumnTitle } from '../../../layout/ColumnTitle'
import { useLeaveTo } from '../../../layout/backHistory'
import { BackLink, PaneBar } from '../../../layout/PaneBar'
import { DELETE, useConfirm } from '../../../ui/Confirm'
import { EmptyState } from '../../../ui/EmptyState'
import { ActionRow } from '../../../ui/form/ActionRow'
import { Group } from '../../../ui/form/Group'
import { TextField } from '../../../ui/form/TextField'
import { LocationMap } from '../../../ui/LocationMap'
import { useLatest } from '../../../ui/useLatest'
import { SAVED_LOCATIONS } from '../../recordings/recordingsCopy'
import {
  RECORDINGS_SETTINGS,
  DELETE_LOCATION,
  DELETE_LOCATION_MESSAGE,
  deleteLocationTitle,
  LOCATION_GONE,
  SAVED_LOCATION_NAME_HELP,
  SAVED_LOCATION_NAME_LABEL,
  SAVED_LOCATION_RECORDINGS,
  savedLocationRecordings,
} from '../settingsCopy'
import { settingsPagePath } from '../settingsPaths'
import { useSavedLocations } from '../useSavedLocations'

const LIST = settingsPagePath('recordings')

/**
 * One saved location, titled with its name: its map, a Name field that renames at once, its
 * address, how many recordings use it, and Delete. A name typed and left unsaved is saved when
 * the page is left.
 */
export function SavedLocationDetail({ placeId }: { placeId: string }) {
  const { rows, failure, clearFailure, rename, remove } = useSavedLocations()
  const confirm = useConfirm()
  const leave = useLeaveTo()
  const row = rows?.find((one) => one.place.id === placeId)
  const stored = row?.place.name
  // What was typed over the stored name, kept while the field has focus so a rename made
  // elsewhere never drops the typing; a commit clears it. Unfocused, the field follows the
  // stored name.
  const [typed, setTyped] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [seen, setSeen] = useState(stored)
  if (seen !== stored) {
    setSeen(stored)
    if (!focused) setTyped(null)
  }
  const shown = typed ?? stored ?? ''

  const latestRef = useLatest({ typed, stored, rename })
  useEffect(() => {
    clearFailure()
    return () => {
      // The ref holds the last render's values, which is what leaving should save.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const { typed: pending, stored: current, rename: save } = latestRef.current
      if (pending !== null && current !== undefined && pending.trim() !== current) {
        void save(placeId, pending)
      }
    }
  }, [clearFailure, latestRef, placeId])

  const commit = async () => {
    if (typed === null || stored === undefined) return
    // A name that is saved, refused, or already stored hands the field back to the stored one.
    if (typed.trim() !== stored) await rename(placeId, typed)
    setTyped(null)
  }

  const askDelete = async () => {
    if (!row) return
    const ok = await confirm({
      title: deleteLocationTitle(row.place.name),
      message: DELETE_LOCATION_MESSAGE,
      action: DELETE,
    })
    if (ok && (await remove(placeId))) leave(LIST)
  }

  const title = stored ?? SAVED_LOCATIONS
  return (
    <>
      <PaneBar title={title} leading={<BackLink to={LIST} label={RECORDINGS_SETTINGS} onWide />} />
      <div className="max-w-page mx-auto w-full">
        <ColumnTitle title={title} syncBadge={false} />
        <div className="px-4 pb-12">
          {row ? (
            <>
              <LocationMap lat={row.place.lat} lon={row.place.lon} accuracyM={null} />
              <Group help={SAVED_LOCATION_NAME_HELP} error={failure ?? undefined}>
                <form
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault()
                    void commit()
                  }}
                >
                  <div className="ph-no-capture">
                    <TextField
                      label={SAVED_LOCATION_NAME_LABEL}
                      value={shown}
                      maxLength={PLACE_LIMITS.name}
                      enterKeyHint="done"
                      onChange={setTyped}
                      onFocusChange={(hasFocus) => {
                        setFocused(hasFocus)
                        if (!hasFocus) void commit()
                      }}
                    />
                  </div>
                </form>
                {row.place.address && (
                  <p className="t-body text-ink-2 ph-no-capture min-h-(--target) px-4 py-3">
                    {row.place.address}
                  </p>
                )}
                <p className="t-body flex min-h-(--target) items-center justify-between px-4 py-3">
                  <span>{SAVED_LOCATION_RECORDINGS}</span>
                  <span className="text-ink-2">{savedLocationRecordings(row.recordings)}</span>
                </p>
              </Group>
              <Group>
                <ActionRow label={DELETE_LOCATION} destructive onPress={() => void askDelete()} />
              </Group>
            </>
          ) : (
            rows !== undefined && <EmptyState icon={MapPin} title={LOCATION_GONE} />
          )}
        </div>
      </div>
    </>
  )
}

/**
 * Where a saved recording sends the musician: its tune's page, or Recordings with no tune. Null
 * when `here` is already that place, so a second copy of the page never stacks behind the one
 * open. A tune page lives in every destination, so any path whose last segment is the tune's id
 * is that page.
 */
export function savedRecordingPath(tuneId: string | null, here: string): string | null {
  const path = tuneId ? `/catalog/${tuneId}` : '/recordings'
  const trimmed = here.length > 1 ? here.replace(/\/+$/, '') : here
  const alreadyThere = tuneId ? trimmed.split('/').at(-1) === tuneId : trimmed === path
  return alreadyThere ? null : path
}

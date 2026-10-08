/** What a live region says once a moved row has landed; `position` counts from 1. */
export const movedAnnouncement = (title: string, position: number, count: number) =>
  `Moved ${title} to position ${position} of ${count}`

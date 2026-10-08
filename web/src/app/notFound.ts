/** The not-found route's handle, so the tracker never keeps its address as a destination's place. */
export const NOT_FOUND = { notFound: true } as const

/** Whether a route handle marks the not-found route. */
export const isNotFound = (handle: unknown) => handle === NOT_FOUND

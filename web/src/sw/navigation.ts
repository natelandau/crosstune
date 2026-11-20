// The precached entry that every navigation falls back to.
export const APP_SHELL = 'index.html'

// The API is never served from cache and never falls back to the shell.
export const NAVIGATION_DENYLIST: RegExp[] = [/^\/v1\//]

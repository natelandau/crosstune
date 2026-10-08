/** What the one player holds: a link's embed or a recording. */
export type PlayerItem = { kind: 'link'; id: string } | { kind: 'recording'; id: string }

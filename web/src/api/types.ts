import type { components } from './schema'

export type Schemas = components['schemas']

export type Change = Schemas['Change']
export type TableName = Change['table']
export type PushResponse = Schemas['PushResponse']
export type PullResponse = Schemas['PullResponse']
export type ChangeResult = PushResponse['results'][number]
export type PullRow = PullResponse['rows'][number]
export type ResolveResponse = Schemas['ResolveResponse']
export type Problem = Schemas['Problem']

export type SongRow = Schemas['SongRow']
export type UserSongRow = Schemas['UserSongRow']
export type RecordingLinkRow = Schemas['RecordingLinkRow']
export type ListRow = Schemas['ListRow']
export type ListItemRow = Schemas['ListItemRow']

export interface SyncApi {
  push(changes: Change[]): Promise<PushResponse>
  pull(since: number): Promise<PullResponse>
  resolveLink(url: string): Promise<ResolveResponse>
}

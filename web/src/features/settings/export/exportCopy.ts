export const EXPORT_DATA = 'Export data'
export const EXPORT_TITLE = 'Export data'
export const EXPORT_ACTION = 'Export'
export const exportNeedsConnection = (missing: number) =>
  `Connect to the internet to export ${missing} ${missing === 1 ? 'file that is' : 'files that are'} not on this device.`
export const EXPORT_COMPLETE_NOTE =
  'Exports your tunes, lists, and recording details as spreadsheets, with every recording and scan, in one zip file.'
export const exportProgress = (done: number, total: number) => `Preparing file ${done} of ${total}`

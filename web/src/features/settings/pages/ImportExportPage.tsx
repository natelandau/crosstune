import { ArrowUpRight } from 'lucide-react'
import { useState } from 'react'
import { EXPORT_DATA } from '../export/exportCopy'
import { EXPORT_HEADER, EXPORT_HELP, IMPORT_HEADER, IMPORT_HELP, MORE_INFO } from '../settingsCopy'
import { ActionRow } from '../../../ui/form/ActionRow'
import { Group } from '../../../ui/form/Group'
import { ImportSheet } from '../../import/ImportSheet'
import { IMPORT_HELP_URL, IMPORT_TUNES } from '../../import/importCopy'
import { ExportSheet } from './ExportSheet'

/** Bringing tunes in and taking them out. Both use only the local store, so neither needs a connection. */
export function ImportExportPage() {
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  return (
    <>
      <Group
        header={IMPORT_HEADER}
        help={
          <>
            {IMPORT_HELP}{' '}
            <a
              href={IMPORT_HELP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-action inline-flex items-center gap-0.5"
            >
              {MORE_INFO}
              <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
            </a>
          </>
        }
      >
        <ActionRow label={IMPORT_TUNES} onPress={() => setImporting(true)} />
      </Group>
      <Group header={EXPORT_HEADER} help={EXPORT_HELP}>
        <ActionRow label={EXPORT_DATA} onPress={() => setExporting(true)} />
      </Group>
      <ImportSheet open={importing} entry="settings" onClosed={() => setImporting(false)} />
      <ExportSheet open={exporting} onClosed={() => setExporting(false)} />
    </>
  )
}

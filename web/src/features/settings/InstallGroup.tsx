import { Download } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Key } from 'react-aria-components'
import { openExternal } from '../../platform/openExternal'
import { APP_STORE_URL, install, type InstallOffer } from '../../platform/installOffer'
import { Row } from '../../ui/Row'
import { RowList } from '../../ui/RowList'
import { AppleLogo } from './AppleLogo'
import { RowSummary } from './RowSummary'
import { BLOCK } from './settingsBlock'
import {
  APP_STORE,
  APP_STORE_QR,
  CROSSTUNE_FOR_IPHONE,
  DOWNLOAD_ON_APP_STORE,
  GET_THE_APP_LINE,
  GET_THE_APP,
  INSTALL_CROSSTUNE,
  SCAN_FOR_IPHONE,
} from './settingsCopy'

const ICON = 'text-secondary size-5 shrink-0'

/**
 * The Settings root's ways to get the app: a block with Apple's badge on an iPhone or iPad, a row
 * on a Mac, and elsewhere the iPhone app beside the browser's install prompt.
 */
export function InstallGroup({ offer: { appStore, webInstall } }: { offer: InstallOffer }) {
  if (appStore === 'none') return null
  if (appStore === 'badge') {
    return (
      <AppStoreBlock
        line={GET_THE_APP_LINE}
        art={
          // Apple's artwork as Apple supplies it, at its own size.
          <img
            src="/app-store-badge.svg"
            alt={DOWNLOAD_ON_APP_STORE}
            width={120}
            height={40}
            className="shrink-0"
          />
        }
      />
    )
  }
  if (appStore === 'qr') {
    return (
      <AppStoreBlock
        line={SCAN_FOR_IPHONE}
        art={
          // Black on white in every theme, the contrast a phone camera reads best.
          <img
            src="/app-store-qr.svg"
            alt={APP_STORE_QR}
            width={96}
            height={96}
            className="shrink-0 rounded-(--radius)"
          />
        }
      />
    )
  }
  const title = appStore === 'apple' ? GET_THE_APP : CROSSTUNE_FOR_IPHONE
  const act = (key: Key) => (key === 'install' ? void install() : openExternal(APP_STORE_URL))
  return (
    <div className="pt-4">
      <RowList label={GET_THE_APP} onAction={act}>
        {webInstall ? (
          <Row
            id="install"
            textValue={INSTALL_CROSSTUNE}
            leading={<Download className={ICON} aria-hidden />}
            title={INSTALL_CROSSTUNE}
          />
        ) : null}
        <Row
          id="app-store"
          textValue={`${title}, ${APP_STORE}`}
          leading={
            appStore === 'apple' ? (
              <Download className={ICON} aria-hidden />
            ) : (
              <AppleLogo className={ICON} />
            )
          }
          title={title}
          trailing={<RowSummary>{APP_STORE}</RowSummary>}
        />
      </RowList>
    </div>
  )
}

/**
 * A block that opens the listing: the iPhone app's name and a line beside `art`, Apple's badge
 * on an iPhone or iPad, a code to scan on a computer.
 */
function AppStoreBlock({ line, art }: { line: string; art: ReactNode }) {
  return (
    <div className="px-4 pt-4">
      <a
        href={APP_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`${BLOCK} flex items-center gap-4`}
      >
        <span className="min-w-0 flex-1">
          <span className="t-body flex items-center gap-2">
            <AppleLogo className="size-4 shrink-0" />
            {CROSSTUNE_FOR_IPHONE}
          </span>
          <span className="t-secondary text-secondary mt-1 block">{line}</span>
        </span>
        {art}
      </a>
    </div>
  )
}

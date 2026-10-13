import {
  PRIVACY_POLICY,
  PRIVACY_URL,
  RENEWS_UNTIL_CANCELLED,
  TERMS_OF_USE,
  TERMS_URL,
} from './planCopy'

/** The renewal and the legal pages, which every surface that sells shows beside its price. */
export function RenewalTerms() {
  const link = 'text-action underline-offset-2 hover:underline'
  return (
    <div className="t-caption text-ink-2 flex flex-col items-center gap-1 text-center">
      <p>{RENEWS_UNTIL_CANCELLED}</p>
      <p>
        <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className={link}>
          {TERMS_OF_USE}
        </a>
        <span aria-hidden> · </span>
        <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className={link}>
          {PRIVACY_POLICY}
        </a>
      </p>
    </div>
  )
}

/** The bare CT mark, cropped to its cap height so an `h-*` class matches it to the text beside
 * it. The C takes the text color so the colorway follows the surface; the T takes the `mark`
 * token, coral on every surface. Decorative: the name always sits beside it. */
export function Mark({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="39 104 434 304"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      <g fill="none" strokeWidth="68" strokeLinecap="round">
        <path d="M191 138 H439 M339 138 V374" stroke="var(--color-mark)" />
        <path d="M231 367 A118 118 0 1 1 191 138" stroke="currentColor" />
      </g>
      <rect x="191" y="104" width="48" height="68" fill="currentColor" />
    </svg>
  )
}

/** The mark beside the name at the caller's type role. Geist's cap height is 0.71em, and the
 * gap is 0.4 of it. */
export function Lockup({ className = '' }: { className?: string }) {
  return (
    <p className={`flex items-baseline gap-[0.28em] ${className}`}>
      <Mark className="h-[0.71em]" />
      Crosstune
    </p>
  )
}

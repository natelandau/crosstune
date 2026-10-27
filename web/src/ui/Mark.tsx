/** The bare CT mark, cropped to its cap height so an `h-*` class matches it to the text beside
 * it. The C takes the `brand-secondary` token so the colorway follows the scheme; the T takes the
 * `brand` token, coral on every surface. Decorative: the name always sits beside it. */
export function Mark({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="39 104 434 304"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      <g fill="none" strokeWidth="68" strokeLinecap="round">
        <path d="M191 138 H439 M339 138 V374" stroke="var(--brand)" />
        <path d="M231 367 A118 118 0 1 1 191 138" stroke="var(--brand-secondary)" />
      </g>
      <rect x="191" y="104" width="48" height="68" fill="var(--brand-secondary)" />
    </svg>
  )
}

/** The mark beside the name at the caller's type role. The system font's cap height is close
 * to 0.7em, and the gap is 0.4 of it. Inline so it can sit inside a link. */
export function Lockup({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-[0.28em] ${className}`}>
      <Mark className="h-[0.71em]" />
      Crosstune
    </span>
  )
}

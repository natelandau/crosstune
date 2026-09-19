import type { ReactNode } from 'react'

export function InlineError({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <p role="alert" className={`type-footnote text-(--ion-color-danger) ${className}`}>
      {children}
    </p>
  )
}

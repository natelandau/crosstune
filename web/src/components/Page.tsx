import type { ReactNode } from 'react'

/**
 * The page-level typography and spacing system. Every screen composes these so that
 * hierarchy and rhythm are decided once: a page heading, sections 32px apart, a section
 * heading one step below the page heading, 12px between blocks inside a section, and a
 * control 4px from the help text that explains it.
 */

export function Page({ children }: { children: ReactNode }) {
  return <div className="space-y-8">{children}</div>
}

export function PageHeading({ children }: { children: ReactNode }) {
  return <h1 className="text-heading">{children}</h1>
}

export function Section({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      {title ? <h2 className="text-title">{title}</h2> : null}
      {children}
    </section>
  )
}

/** A control and the text that explains it, kept closer together than anything around them. */
export function Field({ children }: { children: ReactNode }) {
  return <div className="space-y-1">{children}</div>
}

export function HelpText({ children }: { children: ReactNode }) {
  return <p className="text-meta opacity-70">{children}</p>
}

export function ErrorText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="alert"
      className={className ? `text-error text-meta ${className}` : 'text-error text-meta'}
    >
      {children}
    </p>
  )
}

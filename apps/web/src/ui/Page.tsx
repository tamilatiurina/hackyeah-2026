import type { ReactNode } from 'react'

/** Page container: centres content at max 1480px and stacks sections with a 28px gap. Wrap every page in it. */
export function PageShell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`mx-auto flex w-full max-w-[1480px] flex-col gap-7 ${className}`}>{children}</section>
}

/** Page title row with optional badge beside the title, description, meta line and right-aligned
 * actions; ends in a bottom rule. */
export function PageHeader({
  title,
  badge,
  description,
  actions,
  meta,
}: {
  title: ReactNode
  badge?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
}) {
  const heading = <h1 className="m-0 text-[clamp(28px,3vw,32px)] font-semibold tracking-[-0.025em] break-words">{title}</h1>
  return (
    <header className="flex flex-wrap items-end justify-between gap-5 border-b border-line pb-6">
      <div className="flex min-w-0 max-w-3xl flex-col gap-1.5">
        {badge ? (
          <div className="flex flex-wrap items-center gap-3">
            {heading}
            {badge}
          </div>
        ) : (
          heading
        )}
        {description && <p className="m-0 max-w-[72ch] text-[15px] leading-6 text-muted">{description}</p>}
        {meta && <div className="mt-1 min-w-0 text-xs leading-5 text-muted">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/** Dashed placeholder card with the shield icon, shown when a list has no items yet; optional call to action. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
      <svg aria-hidden="true" viewBox="0 0 48 48" className="mb-5 h-12 w-12 text-teal" fill="none">
        <path d="M24 5.5 39 11v11.3c0 9.2-6.2 16.8-15 20.2-8.8-3.4-15-11-15-20.2V11l15-5.5Z" stroke="currentColor" strokeWidth="2" />
        <path d="M17 24.5h4.4l2.3-6 4.2 12 2.2-6H35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <h2 className="m-0 text-lg font-semibold tracking-[-0.01em]">{title}</h2>
      <div className="mt-2 max-w-md text-sm leading-6 text-muted">{description}</div>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Skeleton table rows shown while a list loads; `label` is announced to screen readers. */
export function LoadingRows({ label, count = 3 }: { label: string; count?: number }) {
  return (
    <div role="status" aria-label={label} className="overflow-hidden rounded-xl border border-line bg-surface">
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, row) => (
        <div key={row} className="grid min-h-20 grid-cols-[minmax(140px,1.5fr)_repeat(3,1fr)] items-center gap-6 border-b border-line px-5 last:border-b-0">
          <span className="h-3 w-3/4 rounded-full bg-line" />
          <span className="h-3 w-2/3 rounded-full bg-line" />
          <span className="h-3 w-1/2 rounded-full bg-line" />
          <span className="h-7 w-16 rounded-full bg-line" />
        </div>
      ))}
    </div>
  )
}

/** Bordered, horizontally scrollable region that wraps a data `<table>`; `label` names the region. */
export function TableFrame({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={`data-table overflow-x-auto rounded-xl border border-line bg-surface ${className}`}
    >
      {children}
    </div>
  )
}

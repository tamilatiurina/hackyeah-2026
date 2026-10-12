import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { GuardrailAction } from '../../api/types'
import { badgeClass, buttonSecondary } from '../../ui/classes'

// Small pieces shared by the agent workspace sections (pages/agent/*).

/** White section card with a title row; the workspace stacks these. */
export const sectionCard = 'flex flex-col gap-5 rounded-xl border border-line bg-surface p-5 sm:px-6'
export const sectionTitle = 'm-0 text-lg font-semibold'
export const subTitle = 'm-0 text-base font-semibold'
export const sectionText = 'm-0 max-w-[68ch] text-sm leading-[22px] text-muted'
export const smallButton = `${buttonSecondary} min-h-9 px-3 text-[13px]`
export const textLink =
  'inline-flex min-h-9 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-semibold text-teal no-underline hover:text-teal-dark'
export const term = 'text-xs font-semibold tracking-[0.04em] text-muted uppercase'

export function ChevronRight({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  )
}

export function Check({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

export function Lock({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

export type StepState = 'done' | 'next' | 'todo'

/** A step's circle: a check when done, its number otherwise (highlighted when it is next). */
export function StepGlyph({ state, n, size = 20 }: { state: StepState; n: number; size?: number }) {
  const box = { width: size, height: size }
  if (state === 'done') {
    return (
      <span style={box} className="flex shrink-0 items-center justify-center rounded-full bg-teal text-white">
        <Check size={Math.round(size * 0.55)} />
      </span>
    )
  }
  return (
    <span
      style={box}
      className={`flex shrink-0 items-center justify-center rounded-full text-[11px] ${
        state === 'next'
          ? 'border-[1.5px] border-teal bg-teal-soft font-bold text-teal-dark'
          : 'border-[1.5px] border-line-strong font-semibold text-muted'
      }`}
    >
      {n}
    </span>
  )
}

const ACTION_BADGES: Record<GuardrailAction | 'limit' | 'pass', string> = {
  block: 'bg-[#F7E3DF] text-danger',
  redact: 'bg-teal-soft text-teal-dark',
  warn: 'bg-warn-bg text-warn-fg',
  limit: 'bg-[#E6E9F5] text-[#2E3A6B]',
  pass: 'bg-[#F0F0EB] text-[#30343B]',
}

/** Coloured badge for a guardrail action, an audit event or a trace verdict. */
export function ActionBadge({ action, children }: { action: keyof typeof ACTION_BADGES; children: ReactNode }) {
  return <span className={`${badgeClass} ${ACTION_BADGES[action]}`}>{children}</span>
}

/** A link styled as the workspace's teal text action, with a trailing chevron. */
export function ArrowLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={textLink}>
      {children}
      <ChevronRight />
    </Link>
  )
}

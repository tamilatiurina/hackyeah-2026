import type { AuditAction, AuditKind } from '../../api/types'

export function eventKind(event: { kind: AuditKind; action: AuditAction }): AuditAction | 'limit' {
  return event.kind === 'limit' ? 'limit' : event.action
}

/** Copies text and reports what happened through `report` (a toast). */
export async function copyText(text: string, what: string, report: (message: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    report(`${what} copied.`)
  } catch {
    report(`Couldn't copy the ${what.toLowerCase()}. Select it and copy it by hand.`)
  }
}

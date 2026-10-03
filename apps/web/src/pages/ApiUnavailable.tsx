import { isMissingEndpoint } from '../api/audit'
import { buttonSecondary } from '../ui/classes'

const MISSING = "The audit API isn't available on this server yet (A-07)."

/** Load failure for the audit screens: a missing endpoint is explained, anything else can be retried. */
export function LoadError({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  if (isMissingEndpoint(error)) {
    return (
      <p role="alert" className="m-0 rounded-xl bg-warn-bg p-4 text-sm text-warn-fg">
        {MISSING}
      </p>
    )
  }
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-6">
      <span className="text-sm">Couldn't load {what}.</span>
      <button type="button" className={buttonSecondary} onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}

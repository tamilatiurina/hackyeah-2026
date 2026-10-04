import { Link } from 'react-router'
import { usePiSessions } from '../../api/playground'
import { buttonSecondary } from '../../ui/classes'
import { ProjectChips, SessionCard, StatsBand } from './sessionCards'

export function PiSessionsPage() {
  const query = usePiSessions()

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="mr-auto max-w-2xl">
          <h1 className="m-0 text-[28px] font-semibold tracking-tight">Sessions</h1>
          <p className="m-0 text-[13px] text-muted">
            Every pi session on this machine — playground runs included. Counts, costs and tool-call
            stats; transcripts stay on disk. Run a scenario on the{' '}
            <Link to="/playground" className="font-medium">Playground</Link> and watch this page grow.
          </p>
        </div>
        <button type="button" className={buttonSecondary} onClick={() => void query.refetch()}>
          Refresh
        </button>
      </header>

      {query.isError && (
        <div role="alert" className="rounded-lg border border-[#EFC4BC] bg-[#FBEAE6] p-3 text-sm text-danger">
          Couldn't load sessions — is the API running?
          <button type="button" className={`${buttonSecondary} ml-3`} onClick={() => void query.refetch()}>
            Retry
          </button>
        </div>
      )}

      {!query.isSuccess && !query.isError && (
        <div aria-busy="true" className="flex flex-col gap-3">
          <div className="h-24 animate-pulse rounded-xl border border-line bg-surface" />
          <div className="grid gap-4 lg:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-36 animate-pulse rounded-xl border border-line bg-surface" />
            ))}
          </div>
        </div>
      )}

      {query.data && (
        <>
          <StatsBand stats={query.data.stats} />
          <ProjectChips stats={query.data.stats} />
          {query.data.sessions.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface p-5 text-sm text-muted">
              No sessions yet — run a scenario on the Playground or use pi in a terminal.
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {query.data.sessions.map((session) => (
                <SessionCard key={`${session.projectDir}-${session.id}`} session={session} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

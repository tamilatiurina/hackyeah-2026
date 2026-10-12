import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAddSignature, useDeleteSignature, useSignatures } from '../../api/guardrails'
import { buttonPrimary, buttonSecondary, inputClass } from '../../ui/classes'
import { EmptyState, LoadingRows } from '../../ui/Page'

export function SignaturesSection() {
  const signatures = useSignatures()
  const add = useAddSignature()
  const remove = useDeleteSignature()
  const [adding, setAdding] = useState(false)
  const [id, setId] = useState('')
  const [regex, setRegex] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const wasAdding = useRef(false)

  useEffect(() => {
    if (wasAdding.current && !adding) addButtonRef.current?.focus()
    wasAdding.current = adding
  }, [adding])

  const close = () => {
    setAdding(false)
    setId('')
    setRegex('')
    add.reset()
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    add.mutate({ id: id.trim(), regex }, { onSuccess: close })
  }

  const deleteSignature = (signatureId: string) =>
    remove.mutate(signatureId, {
      onSuccess: () => {
        setConfirmingId(null)
        addButtonRef.current?.focus()
      },
    })

  return (
    <section aria-labelledby="signatures-title" className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="signatures-title" className="m-0 text-lg font-semibold">
            Injection signatures
          </h2>
          <span className="text-sm text-muted">Your list, used by the prompt injection guardrail on all your agents.</span>
        </div>
        {!adding && (
          <button ref={addButtonRef} type="button" className={buttonSecondary} onClick={() => setAdding(true)}>
            Add signature
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sig-id" className="text-[13px] font-semibold text-[#30343B]">
              Signature id
            </label>
            <input
              id="sig-id"
              autoFocus
              value={id}
              placeholder="e.g. role-play-escape"
              onChange={(e) => {
                setId(e.target.value)
                add.reset()
              }}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sig-regex" className="text-[13px] font-semibold text-[#30343B]">
              Regex
            </label>
            <input
              id="sig-regex"
              value={regex}
              placeholder="(?i)pretend you are"
              onChange={(e) => {
                setRegex(e.target.value)
                add.reset()
              }}
              className={`${inputClass} font-mono`}
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className={buttonPrimary} disabled={!id.trim() || !regex || add.isPending}>
              {add.isPending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className={buttonSecondary} onClick={close}>
              Cancel
            </button>
          </div>
          {add.error && (
            <p role="alert" className="m-0 text-[13px] text-danger sm:col-span-3">
              {add.error.message}
            </p>
          )}
        </form>
      )}

      {signatures.isError ? (
        <div role="alert" className="flex items-center gap-3 text-sm">
          Couldn't load signatures.
          <button type="button" className={buttonSecondary} onClick={() => void signatures.refetch()}>
            Retry
          </button>
        </div>
      ) : signatures.isPending ? (
        <LoadingRows label="Loading signatures" count={2} />
      ) : signatures.data.length === 0 ? (
        <EmptyState title="No injection signatures" description="Add a pattern for the prompt injection guardrail to match." />
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
          {signatures.data.map((s) => (
            <li key={s.id} className="flex flex-col gap-3 py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="min-w-48 font-mono text-[13px] font-semibold">{s.id}</span>
                <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-muted">{s.regex}</code>
                {confirmingId !== s.id && (
                  <button
                    type="button"
                    aria-label={`Delete ${s.id}`}
                    disabled={remove.isPending}
                    onClick={() => setConfirmingId(s.id)}
                    className={`${buttonSecondary} px-3 text-xs`}
                  >
                    Delete
                  </button>
                )}
              </div>
              {confirmingId === s.id && (
                <div role="group" aria-label={`Confirm deletion of ${s.id}`} className="flex flex-wrap items-center gap-2 rounded-lg bg-[#FBE7E2] p-3">
                  <span className="mr-auto text-sm font-semibold text-danger">Delete {s.id}?</span>
                  <button
                    type="button"
                    autoFocus
                    aria-label={`Confirm delete ${s.id}`}
                    disabled={remove.isPending}
                    onClick={() => deleteSignature(s.id)}
                    className={`${buttonSecondary} border-danger px-3 text-xs text-danger`}
                  >
                    {remove.isPending ? 'Deleting…' : 'Confirm delete'}
                  </button>
                  <button type="button" disabled={remove.isPending} onClick={() => setConfirmingId(null)} className={`${buttonSecondary} px-3 text-xs`}>
                    Cancel
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {remove.error && (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {remove.error.message}
        </p>
      )}
    </section>
  )
}

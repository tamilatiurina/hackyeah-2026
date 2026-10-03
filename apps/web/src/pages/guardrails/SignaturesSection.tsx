import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAddSignature, useDeleteSignature, useSignatures } from '../../api/guardrails'
import { useRole } from '../../app/role'
import { buttonPrimary, buttonSecondary, inputClass } from '../../ui/classes'

export function SignaturesSection() {
  const { role } = useRole()
  const isAdmin = role === 'admin'
  const signatures = useSignatures()
  const add = useAddSignature()
  const remove = useDeleteSignature()
  const [adding, setAdding] = useState(false)
  const [id, setId] = useState('')
  const [regex, setRegex] = useState('')
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
    remove.mutate(signatureId, { onSuccess: () => addButtonRef.current?.focus() })

  return (
    <section aria-labelledby="signatures-title" className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="signatures-title" className="m-0 text-lg font-semibold">
            Injection signatures
          </h2>
          <span className="text-sm text-muted">One company-wide list, used by every agent. Admins edit it.</span>
        </div>
        {isAdmin ? (
          !adding && (
            <button ref={addButtonRef} type="button" className={buttonSecondary} onClick={() => setAdding(true)}>
              Add signature
            </button>
          )
        ) : (
          <span className="text-xs text-muted">Read-only for developers</span>
        )}
      </div>

      {isAdmin && adding && (
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
              Save
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
        <p className="m-0 text-sm text-muted">Loading signatures…</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
          {signatures.data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
              <span className="min-w-48 font-mono text-[13px] font-semibold">{s.id}</span>
              <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-muted">{s.regex}</code>
              {isAdmin && (
                <button
                  type="button"
                  aria-label={`Delete ${s.id}`}
                  disabled={remove.isPending}
                  onClick={() => deleteSignature(s.id)}
                  className={`${buttonSecondary} px-3 text-xs`}
                >
                  Delete
                </button>
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

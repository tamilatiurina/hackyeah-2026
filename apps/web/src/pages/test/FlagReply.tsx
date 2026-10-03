import { useState, type FormEvent } from 'react'
import { ApiError } from '../../api/client'
import { useFlagReply } from '../../api/testChat'
import { buttonPrimary, buttonSecondary, inputClass } from '../../ui/classes'

interface FlagReplyProps {
  agentId: string
  contextId: string
  messageId: string
  label: string
}

/** FR-12: flag a reply as not meeting requirements, with a comment for the owning developer. */
export function FlagReply({ agentId, contextId, messageId, label }: FlagReplyProps) {
  const flag = useFlagReply(agentId)
  const [open, setOpen] = useState(false)
  const [comment, setComment] = useState('')
  const id = `flag-${messageId}`

  if (flag.isSuccess) return <span className="text-xs font-semibold text-teal-dark">Flagged</span>

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (comment.trim()) flag.mutate({ contextId, messageId, comment: comment.trim() })
  }

  const error =
    flag.error instanceof ApiError && (flag.error.status === 404 || flag.error.status === 405)
      ? "Flagging isn't available on this API yet."
      : flag.error?.message

  if (!open) {
    return (
      <button type="button" aria-label={label} onClick={() => setOpen(true)} className={`${buttonSecondary} px-3 text-xs`}>
        Flag reply
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-2">
      <label htmlFor={id} className="text-xs font-semibold text-[#30343B]">
        Comment
      </label>
      <textarea id={id} rows={2} autoFocus value={comment} onChange={(e) => setComment(e.target.value)} className={`${inputClass} py-2`} />
      {error && (
        <p role="alert" className="m-0 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={!comment.trim() || flag.isPending} className={`${buttonPrimary} px-3 text-xs`}>
          Send flag
        </button>
        <button type="button" onClick={() => setOpen(false)} className={`${buttonSecondary} px-3 text-xs`}>
          Cancel
        </button>
      </div>
    </form>
  )
}

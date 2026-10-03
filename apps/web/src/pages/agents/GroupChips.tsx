import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useCreateGroup } from '../../api/agents'
import type { Group } from '../../api/types'
import { buttonPrimary, buttonSecondary, inputClass } from '../../ui/classes'

interface GroupChipsProps {
  groups: readonly Group[]
  selectedId: string | null
  onSelect: (groupId: string | null) => void
}

const chip = (on: boolean) =>
  `min-h-11 cursor-pointer rounded-full border px-4 text-sm font-medium ${
    on ? 'border-ink bg-ink text-white' : 'border-line-strong bg-surface text-ink hover:bg-canvas'
  }`

export function GroupChips({ groups, selectedId, onSelect }: GroupChipsProps) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const createGroup = useCreateGroup()
  const newGroupButtonRef = useRef<HTMLButtonElement>(null)
  const wasAdding = useRef(false)

  useEffect(() => {
    if (wasAdding.current && !adding) newGroupButtonRef.current?.focus()
    wasAdding.current = adding
  }, [adding])
  const chips: { id: string | null; name: string }[] = [{ id: null, name: 'All' }, ...groups]

  const close = () => {
    setAdding(false)
    setName('')
    createGroup.reset()
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    createGroup.mutate(name.trim(), {
      onSuccess: (group) => {
        close()
        onSelect(group.id)
      },
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Filter by group" className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button
            key={c.id ?? 'all'}
            type="button"
            aria-pressed={selectedId === c.id}
            onClick={() => onSelect(c.id)}
            className={chip(selectedId === c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>
      {adding ? (
        <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <label htmlFor="new-group-name" className="sr-only">
            Group name
          </label>
          <input
            id="new-group-name"
            autoFocus
            value={name}
            placeholder="Group name"
            onChange={(event) => {
              setName(event.target.value)
              createGroup.reset()
            }}
            aria-invalid={createGroup.isError}
            aria-describedby={createGroup.isError ? 'new-group-error' : undefined}
            className={`${inputClass} w-48`}
          />
          <button type="submit" className={buttonPrimary} disabled={!name.trim() || createGroup.isPending}>
            Save
          </button>
          <button type="button" className={buttonSecondary} onClick={close}>
            Cancel
          </button>
          {createGroup.error && (
            <span id="new-group-error" role="alert" className="text-sm text-danger">
              {createGroup.error.message}
            </span>
          )}
        </form>
      ) : (
        <button
          ref={newGroupButtonRef}
          type="button"
          onClick={() => setAdding(true)}
          className="min-h-11 cursor-pointer rounded-full border border-dashed border-line-strong bg-transparent px-4 text-sm font-medium text-muted hover:text-ink"
        >
          New group
        </button>
      )}
    </div>
  )
}

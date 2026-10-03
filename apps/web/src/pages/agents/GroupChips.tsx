import type { Group } from '../../api/types'

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
  const chips: { id: string | null; name: string }[] = [{ id: null, name: 'All' }, ...groups]
  return (
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
  )
}

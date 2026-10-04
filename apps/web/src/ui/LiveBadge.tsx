/** Shown while a page gets live updates (#102). */
export function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-dark" title="Updates as new events are recorded">
      <span aria-hidden="true" className="size-2 rounded-full bg-teal" />
      Live
    </span>
  )
}

interface BrandProps {
  subtitle?: string
}

export function Brand({ subtitle = 'Acme workspace' }: BrandProps) {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="shrink-0 text-teal-bright"
      >
        <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
      <div className="flex flex-col">
        <span className="text-base font-bold text-white">Guardrail Hub</span>
        <span className="text-xs text-sidebar-subtle">{subtitle}</span>
      </div>
    </div>
  )
}

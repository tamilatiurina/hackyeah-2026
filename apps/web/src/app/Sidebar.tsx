import { NavLink, useNavigate } from 'react-router'
import { useAuth } from '../auth/context'
import { Brand } from './Brand'
import { DEFAULT_HOME, TESTER_HOME, navItemsFor } from './nav'
import { ROLES, useRole, type Role } from './role'

interface SidebarProps {
  id: string
  open: boolean
  onNavigate: () => void
  counts?: Partial<Record<string, number>>
}

export function Sidebar({ id, open, onNavigate, counts = {} }: SidebarProps) {
  const { role, setRole } = useRole()
  const { session, signOut } = useAuth()
  const navigate = useNavigate()
  const note = ROLES.find((r) => r.id === role)?.note

  const pickRole = (next: Role) => {
    if (next !== role) {
      setRole(next)
      if (next === 'tester') navigate(TESTER_HOME)
      else if (role === 'tester') navigate(DEFAULT_HOME)
    }
    onNavigate()
  }

  return (
    <aside
      id={id}
      data-open={open}
      className={`on-dark fixed inset-y-0 left-0 z-40 flex w-[min(280px,85vw)] flex-col gap-7 overflow-y-auto bg-sidebar px-4 py-6 text-white transition-transform md:sticky md:top-0 md:z-auto md:h-screen md:w-60 md:shrink-0 md:translate-x-0 ${
        open ? 'translate-x-0' : 'max-md:invisible -translate-x-full'
      }`}
    >
      <Brand />
      <nav aria-label="Main" className="flex flex-col gap-1">
        {navItemsFor(role).map((item) => {
          const count = counts[item.path] ?? 0
          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 text-sm no-underline ${
                  isActive
                    ? 'bg-sidebar-active font-semibold text-white hover:text-white'
                    : 'font-medium text-sidebar-muted hover:bg-sidebar-active/60 hover:text-white'
                }`
              }
            >
              <span>{item.label}</span>
              {count > 0 && (
                <span className="min-w-[22px] rounded-full bg-amber px-[7px] py-px text-center text-xs font-bold text-sidebar">
                  {count}
                </span>
              )}
            </NavLink>
          )
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-2 px-2">
        {session && (
          <div className="flex flex-col gap-2 border-b border-sidebar-track pb-4">
            <span className="truncate text-xs text-sidebar-subtle" title={session.email}>
              {session.email}
            </span>
            <button
              type="button"
              onClick={() => {
                onNavigate()
                void signOut()
              }}
              className="min-h-11 cursor-pointer rounded-lg border border-sidebar-track bg-transparent px-3 text-left text-sm font-medium text-sidebar-muted hover:bg-sidebar-active hover:text-white"
            >
              Sign out
            </button>
          </div>
        )}
        <span id={`${id}-role-label`} className="text-xs tracking-[0.06em] text-sidebar-subtle uppercase">
          Viewing as
        </span>
        <div
          role="group"
          aria-labelledby={`${id}-role-label`}
          className="flex gap-1 rounded-[10px] bg-sidebar-track p-1"
        >
          {ROLES.map((r) => {
            const on = r.id === role
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={on}
                onClick={() => pickRole(r.id)}
                className={`min-h-11 flex-1 cursor-pointer rounded-[7px] border-0 px-1.5 text-xs font-semibold ${
                  on ? 'bg-white text-sidebar' : 'bg-transparent text-sidebar-muted hover:text-white'
                }`}
              >
                {r.label}
              </button>
            )
          })}
        </div>
        <p className="m-0 text-xs leading-[1.45] text-sidebar-subtle">{note}</p>
      </div>
    </aside>
  )
}

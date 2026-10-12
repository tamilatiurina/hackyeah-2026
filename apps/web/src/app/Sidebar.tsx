import { Fragment } from 'react'
import { NavLink } from 'react-router'
import { useAuth } from '../auth/context'
import { Brand } from './Brand'
import { NAV_ITEMS } from './nav'

interface SidebarProps {
  id: string
  open: boolean
  onNavigate: () => void
  counts?: Partial<Record<string, number>>
}

/** Dark app navigation: brand, nav links grouped into sections with count badges, and the signed-in account. Needs a router and the Auth context. */
export function Sidebar({ id, open, onNavigate, counts = {} }: SidebarProps) {
  const { session, signOut } = useAuth()

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
        {NAV_ITEMS.map((item, index, items) => {
          const count = counts[item.path] ?? 0
          const startsSection = item.section && item.section !== items[index - 1]?.section
          return (
            <Fragment key={item.path}>
              {startsSection && (
                // a divider, not a row: a hairline rule and no row padding so it can't pass for a link
                <span className="mt-5 mb-1.5 flex cursor-default items-center gap-2 pl-1 text-[10px] font-semibold tracking-[0.12em] text-sidebar-subtle uppercase select-none after:h-px after:flex-1 after:bg-sidebar-active after:content-['']">
                  {item.section}
                </span>
              )}
              <NavLink
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
            </Fragment>
          )
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-2 px-2">
        {session && (
          <>
            <span className="truncate text-xs text-sidebar-subtle" title={session.email || undefined}>
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
          </>
        )}
      </div>
    </aside>
  )
}

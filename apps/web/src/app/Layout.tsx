import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { ToastProvider } from '../ui/Toast'
import { Brand } from './Brand'
import { Sidebar } from './Sidebar'

const SIDEBAR_ID = 'app-sidebar'

/** App shell: Sidebar on the left (drawer on phones) and the routed page in `<main>` via `<Outlet>`, with toasts. Use as a parent route element. */
export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const location = useLocation()
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  // Esc and backdrop close the drawer without moving anywhere, so put focus back on Menu
  const dismissMenu = useCallback(() => {
    setMenuOpen(false)
    menuButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    document.getElementById(SIDEBAR_ID)?.querySelector('a')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissMenu()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen, dismissMenu])

  useEffect(() => {
    mainRef.current?.focus()
  }, [location.pathname])

  return (
    <div className="min-h-screen bg-canvas text-ink md:flex">
      <a href="#main-content" className="fixed top-2 left-2 z-50 -translate-y-20 rounded-lg bg-surface px-4 py-3 text-sm font-semibold shadow-lg transition-transform focus:translate-y-0">
        Skip to content
      </a>
      <header className="on-dark sticky top-0 z-20 flex h-14 items-center justify-between bg-sidebar px-2 md:hidden">
        <Brand />
        <button
          ref={menuButtonRef}
          type="button"
          aria-expanded={menuOpen}
          aria-controls={SIDEBAR_ID}
          onClick={() => setMenuOpen((open) => !open)}
          className="min-h-11 cursor-pointer rounded-lg border-0 bg-transparent px-3 text-sm font-semibold text-sidebar-muted hover:bg-sidebar-active hover:text-white"
        >
          Menu
        </button>
      </header>
      {menuOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={dismissMenu}
          className="fixed inset-0 z-30 cursor-default border-0 bg-black/40 md:hidden"
        />
      )}
      <Sidebar id={SIDEBAR_ID} open={menuOpen} onNavigate={closeMenu} />
      <main ref={mainRef} id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-[clamp(16px,4vw,40px)] pt-8 pb-12 outline-none">
        <ToastProvider>
          <Outlet />
        </ToastProvider>
      </main>
    </div>
  )
}

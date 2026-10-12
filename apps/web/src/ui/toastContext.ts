import { createContext, use } from 'react'

export const ToastContext = createContext<(message: string) => void>(() => {})

/** Shows a short confirmation in the bottom-right corner; a new message replaces the current one. */
export function useToast(): (message: string) => void {
  return use(ToastContext)
}

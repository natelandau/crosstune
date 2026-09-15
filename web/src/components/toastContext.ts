import { createContext, useContext } from 'react'

export const TOAST_MS = 8000

export interface ToastOptions {
  message: string
  undo?: () => Promise<void>
}

export interface ToastApi {
  show: (options: ToastOptions) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const toast = useContext(ToastContext)
  if (!toast) throw new Error('useToast needs a ToastProvider')
  return toast
}

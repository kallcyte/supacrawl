import { useEffect, useState } from "react"

export interface Toast {
  id: string
  title?: string
  description?: string
  variant?: "default" | "success" | "destructive"
}

interface ToastState {
  toasts: Toast[]
}

let toastListeners: ((state: ToastState) => void)[] = []
let memoryState: ToastState = { toasts: [] }

function dispatch(toast: Omit<Toast, "id">) {
  const id = Math.random().toString(36).slice(2, 9)
  memoryState = { toasts: [...memoryState.toasts, { ...toast, id }] }
  toastListeners.forEach((l) => l(memoryState))
  setTimeout(() => {
    memoryState = { toasts: memoryState.toasts.filter((t) => t.id !== id) }
    toastListeners.forEach((l) => l(memoryState))
  }, 4000)
}

export function toast(toast: Omit<Toast, "id">) {
  dispatch(toast)
}

export function useToast() {
  const [state, setState] = useState<ToastState>(memoryState)

  useEffect(() => {
    toastListeners.push(setState)
    return () => {
      toastListeners = toastListeners.filter((l) => l !== setState)
    }
  }, [])

  return { toasts: state.toasts, toast }
}

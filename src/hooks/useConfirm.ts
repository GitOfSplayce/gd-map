import { createContext, useContext, type ReactNode } from 'react'

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Action destructive : bouton de confirmation en rouge. */
  danger?: boolean
}

export const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => false)

/** Boîte de confirmation aux couleurs de l'application (remplace window.confirm). */
export const useConfirm = () => useContext(ConfirmContext)

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ConfirmContext, type ConfirmOptions } from '../hooks/useConfirm'
import Icon from './Icon'

interface Pending {
  options: ConfirmOptions
  resolve: (ok: boolean) => void
}

export default function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ options, resolve })),
    [],
  )

  const close = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok)
      setPending(null)
    },
    [pending],
  )

  useEffect(() => {
    if (!pending) return
    confirmButton.current?.focus()
    // Capture : la boîte passe avant les autres raccourcis (Échap d'un panneau ouvert, par exemple)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return
      e.preventDefault()
      e.stopImmediatePropagation()
      close(e.key === 'Enter')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pending, close])

  const o = pending?.options

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {o && (
        <div className="modal-backdrop" onClick={() => close(false)}>
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
            <div className={'modal-icon' + (o.danger ? ' danger' : '')}>
              <Icon name={o.danger ? 'trash' : 'alert'} size={20} />
            </div>
            <h2 id="confirm-title">{o.title}</h2>
            {o.message && <div className="modal-message">{o.message}</div>}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => close(false)}>
                {o.cancelLabel ?? 'Annuler'}
              </button>
              <button ref={confirmButton} type="button" className={'btn ' + (o.danger ? 'danger-solid' : 'primary')} onClick={() => close(true)}>
                {o.confirmLabel ?? 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

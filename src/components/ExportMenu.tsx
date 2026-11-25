import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverPosition } from '../hooks/usePopoverPosition'
import Icon from './Icon'
import Switch from './Switch'

interface Props {
  disabled: boolean
  /** Vues Couverture et Performance : la légende liste des niveaux, pas des personnes. */
  levels: boolean
  onExport: (options: { withZones: boolean }) => Promise<void>
}

/** Bouton « Export PNG » et ses options, dans une petite fenêtre. */
export default function ExportMenu({ disabled, levels, onExport }: Props) {
  const [open, setOpen] = useState(false)
  const [withZones, setWithZones] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const popStyle = usePopoverPosition(open, buttonRef, popRef, { width: 290, revision: failed })

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!popRef.current?.contains(t) && !buttonRef.current?.contains(t)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      close()
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const run = async () => {
    setBusy(true)
    setFailed(false)
    try {
      await onExport({ withZones })
      setOpen(false)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="btn small"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setFailed(false)
          setOpen((o) => !o)
        }}
      >
        <Icon name="image" size={16} />
        Export PNG
      </button>
      {open &&
        createPortal(
          <div ref={popRef} className="export-pop" role="dialog" aria-label="Export PNG" style={popStyle}>
            <Switch checked={withZones} onChange={setWithZones} label="Départements dans la légende" />
            <p className="muted small">
              {levels ? (
                'Sous chaque niveau, ses départements.'
              ) : (
                <>
                  Sous chaque nom : <b>22, 35P, 52G</b>. P : partiel, G : gestion, GP : gestion-partiel, sans lettre : propre.
                </>
              )}
            </p>
            {failed && <p className="alert error small">L'image n'a pas pu être créée. Réessayez.</p>}
            <button type="button" className="btn primary small" onClick={run} disabled={busy}>
              <Icon name="download" size={16} className={busy ? 'spin' : undefined} />
              {busy ? 'Création…' : 'Télécharger l\'image'}
            </button>
          </div>,
          document.body,
        )}
    </>
  )
}

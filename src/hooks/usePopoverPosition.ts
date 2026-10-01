import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

const MARGIN = 8

/**
 * Place une fenêtre flottante (liste, sélecteur de couleur) près de son bouton, toujours entière à l'écran :
 * dessous si elle tient, sinon dessus, sinon à gauche, sinon à droite, sinon contre le haut avec défilement.
 * La taille réelle est mesurée avant l'affichage (rendu masqué puis placé avant que l'écran ne se redessine).
 */
export function usePopoverPosition(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  popover: RefObject<HTMLElement | null>,
  options: { gap?: number; width?: number } = {},
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden', top: 0, left: 0 })
  const gap = options.gap ?? 6

  useLayoutEffect(() => {
    if (!open) {
      setStyle({ visibility: 'hidden', top: 0, left: 0, width: options.width })
      return
    }
    const a = anchor.current?.getBoundingClientRect()
    const p = popover.current
    if (!a || !p) return
    const w = p.offsetWidth
    const h = p.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const clampX = (x: number) => Math.max(MARGIN, Math.min(x, vw - w - MARGIN))
    const clampY = (y: number) => Math.max(MARGIN, Math.min(y, vh - h - MARGIN))

    let next: CSSProperties
    if (vh - a.bottom - gap - MARGIN >= h) next = { top: a.bottom + gap, left: clampX(a.left) }
    else if (a.top - gap - MARGIN >= h) next = { top: a.top - gap - h, left: clampX(a.left) }
    else if (a.left - gap - MARGIN >= w) next = { top: clampY(a.top), left: a.left - gap - w }
    else if (vw - a.right - gap - MARGIN >= w) next = { top: clampY(a.top), left: a.right + gap }
    else next = { top: MARGIN, left: clampX(a.left), maxHeight: vh - 2 * MARGIN, overflow: 'auto' }

    setStyle({ ...next, width: options.width, visibility: 'visible' })
    // Recalcul à chaque ouverture ; les fenêtres se ferment au défilement et au redimensionnement
  }, [open])

  return style
}

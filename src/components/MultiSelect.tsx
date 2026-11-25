import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverPosition } from '../hooks/usePopoverPosition'
import { nameKey } from '../lib/text'
import Icon from './Icon'

export interface MultiOption {
  value: string
  label: string
  /** Code court, en étiquette (structures : « MD »). */
  tag?: string
}

interface Props {
  values: string[]
  options: MultiOption[]
  onChange: (values: string[]) => void
  ariaLabel: string
  placeholder?: string
}

/** Choix de plusieurs valeurs dans une liste, avec recherche ; la liste reste ouverte pendant qu'on coche. */
export default function MultiSelect({ values, options, onChange, ariaLabel, placeholder = 'Choisir…' }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [width, setWidth] = useState(260)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const items = useMemo(() => {
    const q = nameKey(query)
    return q ? options.filter((o) => nameKey(o.label).includes(q) || nameKey(o.tag).includes(q)) : options
  }, [query, options])
  // Les valeurs choisies, dans l'ordre de la liste
  const chosen = options.filter((o) => values.includes(o.value))
  const allShown = items.length > 0 && items.every((o) => values.includes(o.value))

  // Le bouton grandit quand les étiquettes passent à la ligne : la liste se replace dessous
  const popStyle = usePopoverPosition(open, buttonRef, popRef, { gap: 4, width, revision: values.length })

  const emit = (next: Set<string>) => onChange(options.map((o) => o.value).filter((v) => next.has(v)))
  const toggle = (value: string) => {
    const next = new Set(values)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    emit(next)
  }
  const toggleShown = () => {
    const next = new Set(values)
    for (const o of items) {
      if (allShown) next.delete(o.value)
      else next.add(o.value)
    }
    emit(next)
  }

  const openMenu = () => {
    setWidth(Math.max(buttonRef.current!.getBoundingClientRect().width, 260))
    setQuery('')
    setActive(0)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!popRef.current?.contains(t) && !buttonRef.current?.contains(t)) close()
    }
    const onScroll = (e: Event) => {
      if (!popRef.current?.contains(e.target as Node)) close()
    }
    // Échap ferme la liste seulement (pas le panneau qui la contient)
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      close()
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  // Garde l'option active visible
  useLayoutEffect(() => {
    if (open) popRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openMenu()
      }
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, Math.min(items.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))))
    } else if (e.key === 'Enter') {
      // Coche, sans envoyer le formulaire
      e.preventDefault()
      if (items[active]) toggle(items[active].value)
    } else if (e.key === 'Backspace' && !query && chosen.length) {
      toggle(chosen[chosen.length - 1].value)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={'select-btn multi' + (open ? ' open' : '')}
        aria-label={`${ariaLabel} : ${chosen.length ? chosen.map((o) => o.label).join(', ') : 'aucune'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className={'multi-values' + (chosen.length ? '' : ' placeholder')}>
          {chosen.length
            ? chosen.map((o) => (
                <span key={o.value} className="multi-value" title={o.label}>
                  {o.tag ?? o.label}
                </span>
              ))
            : placeholder}
        </span>
        <Icon name="chevronDown" size={16} className="select-chevron" />
      </button>

      {open &&
        createPortal(
          <div ref={popRef} className="select-pop" style={popStyle} onKeyDown={onKeyDown}>
            <div className="input-icon select-search">
              <Icon name="search" size={15} />
              <input
                className="input"
                autoFocus
                value={query}
                placeholder="Rechercher…"
                aria-label={`Rechercher : ${ariaLabel}`}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActive(0)
                }}
              />
            </div>
            <button type="button" className="multi-all" disabled={!items.length} onMouseDown={(e) => e.preventDefault()} onClick={toggleShown}>
              {allShown ? 'Tout retirer' : 'Tout choisir'}
              <span className="muted">
                {chosen.length} sur {options.length}
              </span>
            </button>
            <ul role="listbox" aria-label={ariaLabel} aria-multiselectable="true">
              {items.map((item, i) => {
                const on = values.includes(item.value)
                return (
                  <li
                    key={item.value}
                    role="option"
                    aria-selected={on}
                    data-active={i === active}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggle(item.value)}
                  >
                    <span className={'multi-box' + (on ? ' on' : '')}>{on && <Icon name="check" size={12} strokeWidth={3} />}</span>
                    {item.tag && <span className="struct-tag">{item.tag}</span>}
                    <span className="opt-label">{item.label}</span>
                  </li>
                )
              })}
              {!items.length && <li className="empty">Aucun résultat</li>}
            </ul>
          </div>,
          document.body,
        )}
    </>
  )
}

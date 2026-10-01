import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { nameKey } from '../lib/text'
import Icon from './Icon'

export interface SelectOption {
  value: string
  label: string
  hint?: string
  /** Pastille de couleur devant le libellé (managers, commerciaux…). */
  color?: string | null
}

interface Props {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  /** Ajoute en tête une option « vide » (valeur '') avec ce libellé. */
  emptyLabel?: string
  /** Autorise une valeur absente de la liste, saisie dans la recherche. */
  creatable?: boolean
  createLabel?: (text: string) => string
  /** Champ de recherche ; actif d'office au-delà de 8 options ou si `creatable`. */
  searchable?: boolean
  className?: string
}

interface Item extends SelectOption {
  create?: boolean
}

/** Liste déroulante aux couleurs de l'application (remplace <select> et <datalist>). */
export default function Select({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = 'Choisir…',
  emptyLabel,
  creatable = false,
  createLabel = (t) => `Ajouter « ${t} »`,
  searchable,
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const withSearch = searchable ?? (creatable || options.length > 8)

  const items = useMemo<Item[]>(() => {
    const q = nameKey(query)
    let list: Item[] = [...(emptyLabel !== undefined ? [{ value: '', label: emptyLabel }] : []), ...options]
    if (q) list = list.filter((o) => nameKey(o.label).includes(q) || nameKey(o.hint).includes(q))
    const text = query.trim()
    if (creatable && text && !options.some((o) => nameKey(o.label) === q)) list.push({ value: text, label: createLabel(text), create: true })
    return list
  }, [query, options, emptyLabel, creatable, createLabel])

  const selected = options.find((o) => o.value === value)
  const shown = selected ?? (value ? { value, label: value } : null)

  const place = () => {
    const r = buttonRef.current!.getBoundingClientRect()
    const below = window.innerHeight - r.bottom
    const width = Math.max(r.width, 200)
    const left = Math.min(r.left, window.innerWidth - width - 8)
    setPos(below < 300 && r.top > below ? { left, width, bottom: window.innerHeight - r.top + 4 } : { left, width, top: r.bottom + 4 })
  }

  const openMenu = () => {
    place()
    setQuery('')
    setActive(Math.max(0, [...(emptyLabel !== undefined ? [''] : []), ...options.map((o) => o.value)].indexOf(value)))
    setOpen(true)
  }

  const choose = (item: Item) => {
    onChange(item.value)
    setOpen(false)
    buttonRef.current?.focus()
  }

  // Fermeture : clic à l'extérieur, défilement ou redimensionnement
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!popRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false)
    }
    const onScroll = (e: Event) => {
      if (!popRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onResize = () => setOpen(false)
    // Échap ferme la liste seulement (pas le panneau qui la contient)
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  // Garde l'option active visible
  useLayoutEffect(() => {
    if (!open) return
    popRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openMenu()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(items.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (items[active]) choose(items[active])
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={'select-btn' + (open ? ' open' : '') + (className ? ' ' + className : '')}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className={'select-value' + (shown ? '' : ' placeholder')}>
          {shown?.color && <span className="swatch" style={{ background: shown.color }} />}
          <span className="select-text">{shown ? shown.label : (emptyLabel ?? placeholder)}</span>
        </span>
        <Icon name="chevronDown" size={16} className="select-chevron" />
      </button>

      {open &&
        pos &&
        createPortal(
          <div ref={popRef} className="select-pop" style={pos} onKeyDown={onKeyDown}>
            {withSearch && (
              <div className="input-icon select-search">
                <Icon name="search" size={15} />
                <input
                  className="input"
                  autoFocus
                  value={query}
                  placeholder={creatable ? 'Rechercher ou saisir…' : 'Rechercher…'}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setActive(0)
                  }}
                />
              </div>
            )}
            <ul role="listbox" aria-label={ariaLabel}>
              {items.map((item, i) => (
                <li
                  key={(item.create ? 'new:' : '') + item.value}
                  role="option"
                  aria-selected={!item.create && item.value === value}
                  data-active={i === active}
                  className={item.create ? 'create' : undefined}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(item)}
                >
                  {item.create ? (
                    <Icon name="plus" size={15} />
                  ) : item.color ? (
                    <span className="swatch" style={{ background: item.color }} />
                  ) : null}
                  <span className="opt-label">
                    {item.label}
                    {item.hint && <small>{item.hint}</small>}
                  </span>
                  {!item.create && item.value === value && <Icon name="check" size={15} className="opt-check" />}
                </li>
              ))}
              {!items.length && <li className="empty">Aucun résultat</li>}
            </ul>
          </div>,
          document.body,
        )}
    </>
  )
}

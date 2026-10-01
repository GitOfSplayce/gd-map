import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  PALETTE,
  TOO_CLOSE,
  colorDistance,
  hexToHsv,
  hsvToHex,
  isHexColor,
  nextDistinctColor,
  rankedFreeColors,
} from '../lib/colors'
import Icon from './Icon'

interface Props {
  value: string
  onChange: (hex: string) => void
  /** Couleurs déjà prises (par d'autres commerciaux ou managers), avec leur propriétaire. */
  used: { color: string; owner: string }[]
  ariaLabel: string
}

/** Sélecteur de couleur aux couleurs de l'application : suggestions libres, palette, zone de teinte, hexadécimal. */
export default function ColorPicker({ value, onChange, used, ariaLabel }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const [hue, setHue] = useState(() => hexToHsv(value)[0])
  const [hexText, setHexText] = useState(value)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const usedColors = used.map((u) => u.color)
  const ownerOf = (c: string) => used.filter((u) => u.color.toLowerCase() === c.toLowerCase()).map((u) => u.owner)
  const closest = used
    .map((u) => ({ ...u, d: colorDistance(u.color, value) }))
    .filter((u) => u.d < TOO_CLOSE)
    .sort((a, b) => a.d - b.d)[0]
  const [, sat, val] = hexToHsv(value)

  const set = (hex: string, keepHue = false) => {
    onChange(hex)
    setHexText(hex)
    if (!keepHue) setHue(hexToHsv(hex)[0])
  }

  const openPicker = () => {
    const r = buttonRef.current!.getBoundingClientRect()
    const below = window.innerHeight - r.bottom
    const left = Math.min(r.left, window.innerWidth - 300)
    setPos(below < 420 && r.top > below ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 })
    setHexText(value)
    setHue(hexToHsv(value)[0])
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!popRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      setOpen(false)
    }
    const onScroll = (e: Event) => {
      if (!popRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  // Glisser dans la zone saturation / luminosité, ou sur la barre de teinte
  const drag = (kind: 'sv' | 'hue') => (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const update = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect()
      const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width))
      const y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))
      if (kind === 'sv') set(hsvToHex(hue, x, 1 - y), true)
      else {
        const h = x * 359.9
        setHue(h)
        set(hsvToHex(h, Math.max(sat, 0.05), Math.max(val, 0.2)), true)
      }
    }
    update(e)
    const move = (ev: PointerEvent) => update(ev)
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const swatch = (c: string, key: string) => {
    const owners = ownerOf(c)
    const current = c.toLowerCase() === value.toLowerCase()
    return (
      <button
        key={key}
        type="button"
        className={'cp-swatch' + (owners.length ? ' used' : '') + (current ? ' current' : '')}
        style={{ background: c }}
        title={owners.length ? `Déjà utilisée par ${owners.join(', ')}` : c}
        aria-label={owners.length ? `${c}, déjà utilisée par ${owners.join(', ')}` : c}
        onClick={() => set(c)}
      >
        {current && <Icon name="check" size={13} strokeWidth={3} />}
      </button>
    )
  }

  return (
    <>
      <div className="cp-field">
        <button
          ref={buttonRef}
          type="button"
          className={'select-btn cp-button' + (open ? ' open' : '')}
          aria-label={ariaLabel}
          aria-expanded={open}
          onClick={() => (open ? setOpen(false) : openPicker())}
        >
          <span className="select-value">
            <span className="cp-preview" style={{ background: value }} />
            <span className="select-text cp-hex">{value.toUpperCase()}</span>
          </span>
          <Icon name="chevronDown" size={16} className="select-chevron" />
        </button>
        <button
          type="button"
          className="btn small"
          title="Prochaine couleur libre, la plus éloignée de celles déjà utilisées"
          onClick={() => set(nextDistinctColor(usedColors, value))}
        >
          <Icon name="shuffle" size={15} />
          Autre couleur
        </button>
      </div>
      {closest && (
        <div className="cp-warning">
          <Icon name="alert" size={14} />
          {closest.d < 1 ? `Couleur déjà utilisée par ${closest.owner}` : `Très proche de la couleur de ${closest.owner}`}
        </div>
      )}

      {open &&
        pos &&
        createPortal(
          <div ref={popRef} className="cp-pop" style={pos} role="dialog" aria-label="Choisir une couleur">
            <div className="cp-section">
              <span>Couleurs libres conseillées</span>
              <div className="cp-grid">{rankedFreeColors(usedColors, 10).map((c) => swatch(c, 'free-' + c))}</div>
            </div>
            <div className="cp-section">
              <span>Palette</span>
              <div className="cp-grid">{PALETTE.map((c) => swatch(c, 'pal-' + c))}</div>
            </div>
            <div className="cp-section">
              <span>Sur mesure</span>
              <div className="cp-sv" style={{ background: `hsl(${hue} 100% 50%)` }} onPointerDown={drag('sv')}>
                <div className="cp-sv-white" />
                <div className="cp-sv-black" />
                <div className="cp-thumb" style={{ left: `${sat * 100}%`, top: `${(1 - val) * 100}%`, background: value }} />
              </div>
              <div className="cp-hue" onPointerDown={drag('hue')}>
                <div className="cp-thumb" style={{ left: `${(hue / 360) * 100}%`, top: '50%', background: `hsl(${hue} 100% 50%)` }} />
              </div>
              <div className="cp-hex-row">
                <span className="cp-preview large" style={{ background: value }} />
                <input
                  className="input"
                  value={hexText}
                  spellCheck={false}
                  aria-label="Code hexadécimal"
                  onChange={(e) => {
                    const t = e.target.value.trim()
                    setHexText(t)
                    const hex = t.startsWith('#') ? t : '#' + t
                    if (isHexColor(hex)) set(hex.toLowerCase())
                  }}
                />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

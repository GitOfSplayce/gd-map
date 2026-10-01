import { useState } from 'react'
import { COUVERTURE_OPACITY, type ColorMode, type LegendItem } from '../lib/mapModel'

interface Props {
  items: LegendItem[]
  colorMode: ColorMode
  highlighted: Set<string>
  onToggle: (key: string) => void
  onClear: () => void
}

const SAMPLE = '#4363d8'

export function CoverageKey() {
  return (
    <div className="coverage-key" aria-label="Lecture des couleurs">
      <div>
        <span className="swatch" style={{ background: SAMPLE, opacity: COUVERTURE_OPACITY.propre }} /> Propre
      </div>
      <div>
        <span className="swatch" style={{ background: SAMPLE, opacity: COUVERTURE_OPACITY.partiel }} /> Partiel
      </div>
      <div>
        <span
          className="swatch"
          style={{ background: `rgba(67, 99, 216, ${COUVERTURE_OPACITY.gestion})`, border: `1.5px dashed ${SAMPLE}` }}
        />{' '}
        Gestion
      </div>
      <div>
        <span className="swatch" style={{ background: 'repeating-linear-gradient(45deg, #e6194b 0 4px, #3cb44b 4px 8px)' }} /> Partagée
      </div>
    </div>
  )
}

export default function Legend({ items, colorMode, highlighted, onToggle, onClear }: Props) {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const visible = q ? items.filter((it) => it.label.toLowerCase().includes(q) || it.detail.toLowerCase().includes(q)) : items
  const what = colorMode === 'commercial' ? 'commercial' : colorMode === 'manager1' ? 'Manager 1' : 'Manager 2'

  return (
    <>
      <CoverageKey />
      <div className="row" style={{ marginBottom: 8 }}>
        {items.length > 8 && (
          <input
            className="input grow"
            type="search"
            placeholder={`Rechercher un ${what}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
        {highlighted.size > 0 && (
          <button type="button" className="btn small" onClick={onClear}>
            Tout afficher
          </button>
        )}
      </div>
      {!items.length && <p className="muted">Aucune zone à afficher avec ces filtres.</p>}
      <ul className="legend-list">
        {visible.map((it) => (
          <li key={it.key}>
            <button
              type="button"
              className="legend-item"
              aria-pressed={highlighted.has(it.key)}
              onClick={() => onToggle(it.key)}
              title="Cliquer pour mettre ses zones en évidence"
            >
              <span className="swatch" style={{ background: it.color }} />
              <span style={{ minWidth: 0 }}>
                <span className="l-name">{it.label}</span>
                {it.detail && <span className="l-detail">{it.detail}</span>}
              </span>
              <span className="l-count">
                {it.zoneCount} zone{it.zoneCount > 1 ? 's' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

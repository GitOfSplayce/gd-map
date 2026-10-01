import { useState } from 'react'
import { BRAND } from '../lib/colors'
import Icon from './Icon'
import { COUVERTURE_OPACITY, type ColorMode, type LegendItem, type SharedMode } from '../lib/mapModel'
import { plural } from '../lib/text'

type SwatchKind = 'propre' | 'partiel' | 'gestion' | 'rayures' | 'camemberts'

/** Pastille de légende dessinée comme sur la carte (mêmes motifs). */
function KeySwatch({ kind }: { kind: SwatchKind }) {
  const c = BRAND.saphir
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="key-swatch" aria-hidden="true">
      <defs>
        <clipPath id={`ks-${kind}`}>
          <rect width="18" height="18" rx="4.5" />
        </clipPath>
        <pattern id="ks-dots" patternUnits="userSpaceOnUse" width="4.5" height="4.5">
          <circle cx="2.25" cy="2.25" r="1.05" fill={c} />
        </pattern>
      </defs>
      <g clipPath={`url(#ks-${kind})`}>
        <rect width="18" height="18" fill="#ffffff" />
        {kind === 'propre' && <rect width="18" height="18" fill={c} fillOpacity={COUVERTURE_OPACITY.propre} />}
        {kind === 'partiel' && <rect width="18" height="18" fill={c} fillOpacity={COUVERTURE_OPACITY.partiel} />}
        {kind === 'gestion' && (
          <>
            <rect width="18" height="18" fill={c} fillOpacity={0.16} />
            <rect width="18" height="18" fill="url(#ks-dots)" />
          </>
        )}
        {kind === 'rayures' &&
          [-18, -9, 0, 9, 18].map((o, i) => (
            <path key={o} d={`M${o},18 L${o + 18},0 L${o + 22.5},0 L${o + 4.5},18 Z`} fill={i % 2 ? BRAND.jaune : c} />
          ))}
        {kind === 'camemberts' && (
          <>
            <rect width="18" height="18" fill="#eef3fa" />
            <path d="M9,9 L9,3.5 A5.5,5.5 0 0 1 9,14.5 Z" fill={c} />
            <path d="M9,9 L9,14.5 A5.5,5.5 0 0 1 9,3.5 Z" fill={BRAND.jaune} />
          </>
        )}
      </g>
      <rect x="0.5" y="0.5" width="17" height="17" rx="4" fill="none" stroke="rgb(0 0 0 / 12%)" />
    </svg>
  )
}

interface KeyProps {
  sharedMode?: SharedMode
  onSharedMode?: (mode: SharedMode) => void
}

export function CoverageKey({ sharedMode = 'rayures', onSharedMode }: KeyProps) {
  return (
    <div className="coverage-key" aria-label="Lecture des couleurs">
      <div>
        <KeySwatch kind="propre" /> Propre
      </div>
      <div>
        <KeySwatch kind="partiel" /> Partiel
      </div>
      <div>
        <KeySwatch kind="gestion" /> Gestion
      </div>
      <div>
        <KeySwatch kind={sharedMode} /> Partagée
      </div>
      {onSharedMode && (
        <div className="shared-mode">
          <span>Zones partagées</span>
          <div className="seg small">
            <button type="button" aria-pressed={sharedMode === 'rayures'} onClick={() => onSharedMode('rayures')}>
              Rayures
            </button>
            <button type="button" aria-pressed={sharedMode === 'camemberts'} onClick={() => onSharedMode('camemberts')}>
              Camemberts
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function HeatKey() {
  return (
    <div className="heat-key">
      <p>
        Score par zone : chaque commercial compte <strong>1</strong> en propre, <strong>½</strong> en partiel et{' '}
        <strong>¼</strong> en gestion. Les filtres et l'onglet s'appliquent.
      </p>
      <p className="muted small">Cliquez sur un niveau pour isoler ses zones.</p>
    </div>
  )
}

interface Props {
  items: LegendItem[]
  colorMode: ColorMode
  highlighted: Set<string>
  onToggle: (key: string) => void
  onClear: () => void
  sharedMode: SharedMode
  onSharedMode: (mode: SharedMode) => void
}

export default function Legend({ items, colorMode, highlighted, onToggle, onClear, sharedMode, onSharedMode }: Props) {
  const [search, setSearch] = useState('')
  const heat = colorMode === 'couverture'
  const q = search.trim().toLowerCase()
  const visible = q && !heat ? items.filter((it) => it.label.toLowerCase().includes(q) || it.detail.toLowerCase().includes(q)) : items
  const what = colorMode === 'commercial' ? 'commercial' : colorMode === 'manager1' ? 'Manager 1' : 'Manager 2'

  return (
    <>
      {heat ? <HeatKey /> : <CoverageKey sharedMode={sharedMode} onSharedMode={onSharedMode} />}
      <div className="row" style={{ marginBottom: 8 }}>
        {!heat && items.length > 8 && (
          <div className="input-icon grow">
            <Icon name="search" size={16} />
            <input className="input" type="search" placeholder={`Rechercher un ${what}…`} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
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
              title={heat ? 'Cliquer pour isoler les zones de ce niveau' : 'Cliquer pour mettre ses zones en évidence'}
            >
              <span className="swatch" style={{ background: it.color }} />
              <span style={{ minWidth: 0 }}>
                <span className="l-name">{it.label}</span>
                {it.detail && <span className="l-detail">{it.detail}</span>}
              </span>
              <span className="l-count">
                {plural(it.zoneCount, 'zone')}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {heat && <p className="muted small">Comptes sur les départements, les DROM et Monaco.</p>}
    </>
  )
}

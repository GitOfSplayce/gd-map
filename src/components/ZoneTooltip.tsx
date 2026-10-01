import type { MapModel } from '../lib/mapModel'
import { plural } from '../lib/text'
import { COUVERTURE_LABELS } from '../lib/types'
import { coverageText, formatEuros, zonePeople, zoneTitle } from '../lib/zoneDetails'

interface Props {
  code: string
  x: number
  y: number
  model: MapModel
  containerWidth: number
  containerHeight: number
}

export default function ZoneTooltip({ code, x, y, model, containerWidth, containerHeight }: Props) {
  const { title, subtitle } = zoneTitle(code)
  const people = zonePeople(code, model)
  const shown = people.slice(0, 8)

  // Placement : à droite du curseur, ou à gauche s'il n'y a pas la place
  const left = x + 360 > containerWidth ? Math.max(8, x - 350) : x + 16
  const top = Math.min(y + 12, Math.max(8, containerHeight - 60 - shown.length * 54))

  return (
    <div className="tooltip" style={{ left, top }} role="tooltip">
      <div className="t-title">{title}</div>
      <div className="t-sub">{subtitle}</div>
      {model.colorMode === 'couverture' && (
        <div className="t-cov">
          <span className="swatch" style={{ background: model.coverageOf(code).bucket.color }} />
          {coverageText(code, model)}
        </div>
      )}
      {!people.length && <div className="t-empty">Aucun commercial sur cette zone</div>}
      {shown.map((p) => (
        <div className="t-row" key={p.commercial.id + p.structure}>
          <span className="swatch" style={{ background: model.colorOf(p.key) }} />
          <div>
            <div className="t-name">
              {p.commercial.nom} <span className="t-meta">· {p.structure} · {COUVERTURE_LABELS[p.couverture]}</span>
            </div>
            <div className="t-meta">
              Manager 1 : {p.commercial.manager1 || '—'} · Manager 2 : {p.commercial.manager2 || '—'}
            </div>
            {p.scope && <div className="t-meta">{p.scope}</div>}
            {p.objectif && (p.objectif.ca !== null || p.objectif.objectif !== null) && (
              <div className="t-meta">
                CA {model.year} : {formatEuros(p.objectif.ca)} · Objectif : {formatEuros(p.objectif.objectif)}
              </div>
            )}
          </div>
        </div>
      ))}
      {people.length > shown.length && <div className="t-meta">… et {plural(people.length - shown.length, 'autre')}, cliquez pour le détail</div>}
    </div>
  )
}

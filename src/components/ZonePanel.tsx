import type { MapModel } from '../lib/mapModel'
import Icon from './Icon'
import { COUVERTURE_LABELS, STRUCTURE_LABELS, STRUCTURES } from '../lib/types'
import { formatEuros, zonePeople, zoneTitle } from '../lib/zoneDetails'
import { IDF_CODES, ZONE_BY_CODE, isParisArr } from '../lib/zones'
import type { MapViewMode } from './MapView'

interface Props {
  code: string
  model: MapModel
  view: MapViewMode
  highlighted: Set<string>
  onToggleHighlight: (key: string) => void
  onChangeView: (view: MapViewMode) => void
}

export default function ZonePanel({ code, model, view, highlighted, onToggleHighlight, onChangeView }: Props) {
  const { title, subtitle } = zoneTitle(code)
  const people = zonePeople(code, model)
  const zone = ZONE_BY_CODE.get(code)

  return (
    <div className="zone-panel">
      <p className="zp-title">{title}</p>
      <div className="zp-meta">{subtitle}</div>

      {view === 'france' && (code === '75' || isParisArr(code)) && (
        <button type="button" className="btn small" onClick={() => onChangeView('paris')}>
          <Icon name="map" size={16} />
          Voir Paris par arrondissement
        </button>
      )}
      {view === 'france' && zone && IDF_CODES.includes(code) && code !== '75' && (
        <button type="button" className="btn small" onClick={() => onChangeView('idf')}>
          <Icon name="map" size={16} />
          Zoomer sur l'Île-de-France
        </button>
      )}

      {!people.length && <p className="muted">Aucun commercial sur cette zone avec les filtres actuels.</p>}

      {STRUCTURES.filter((s) => people.some((p) => p.structure === s)).map((s) => (
        <div className="zp-section" key={s}>
          <h3>
            {s} – {STRUCTURE_LABELS[s]}
          </h3>
          {people
            .filter((p) => p.structure === s)
            .map((p) => {
              const c = p.commercial
              return (
                <div className="person" key={c.id + s}>
                  <span className="swatch" style={{ background: model.colorOf(p.key) }} />
                  <div>
                    <button
                      type="button"
                      className="p-name"
                      onClick={() => onToggleHighlight(p.key)}
                      aria-pressed={highlighted.has(p.key)}
                      title="Mettre ses zones en évidence"
                    >
                      {c.nom}
                    </button>
                  </div>
                  <dl>
                    <dt>Couverture</dt>
                    <dd>{COUVERTURE_LABELS[p.couverture]}</dd>
                    {p.scope && (
                      <>
                        <dt>Périmètre</dt>
                        <dd>{p.scope}</dd>
                      </>
                    )}
                    <dt>Statut</dt>
                    <dd>{c.statut || '—'}</dd>
                    <dt>Manager 1</dt>
                    <dd>{c.manager1 || '—'}</dd>
                    <dt>Manager 2</dt>
                    <dd>{c.manager2 || '—'}</dd>
                    {c.secteur && (
                      <>
                        <dt>Secteur</dt>
                        <dd>{c.secteur}</dd>
                      </>
                    )}
                    {p.objectif && (p.objectif.ca !== null || p.objectif.objectif !== null) && (
                      <>
                        <dt>CA {model.year}</dt>
                        <dd>{formatEuros(p.objectif.ca)}</dd>
                        <dt>Objectif</dt>
                        <dd>{formatEuros(p.objectif.objectif)}</dd>
                      </>
                    )}
                    {c.actions && (
                      <>
                        <dt>Actions</dt>
                        <dd>{c.actions}</dd>
                      </>
                    )}
                    {c.notes && (
                      <>
                        <dt>Notes</dt>
                        <dd style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</dd>
                      </>
                    )}
                  </dl>
                </div>
              )
            })}
        </div>
      ))}
    </div>
  )
}

import { useState } from 'react'
import type { Filters, MapModel } from '../lib/mapModel'
import { COUVERTURE_LABELS, COUVERTURES, type Commercial } from '../lib/types'

interface Props {
  filters: Filters
  onChange: (f: Filters) => void
  model: MapModel
  commerciaux: Commercial[]
  onClose: () => void
}

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

export default function FiltersPanel({ filters, onChange, model, commerciaux, onClose }: Props) {
  const [search, setSearch] = useState('')
  const managers = model.managers[filters.managerField]
  const q = search.trim().toLowerCase()
  const people = [...commerciaux]
    .filter((c) => c.actif && (!q || c.nom.toLowerCase().includes(q)))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })

  return (
    <div className="filters" role="dialog" aria-label="Filtres">
      <div className="row">
        <strong className="grow">Filtres</strong>
        <button type="button" className="btn small ghost" onClick={() => onChange({ ...filters, managers: [], commerciaux: [], couvertures: [], statuts: [], hideARecruter: false })}>
          Réinitialiser
        </button>
        <button type="button" className="btn small" onClick={onClose}>
          Fermer
        </button>
      </div>

      <h3>Manager</h3>
      <div className="seg" style={{ marginBottom: 6 }}>
        {(['manager1', 'manager2'] as const).map((m) => (
          <button key={m} type="button" aria-pressed={filters.managerField === m} onClick={() => set({ managerField: m, managers: [] })}>
            {m === 'manager1' ? 'Manager 1' : 'Manager 2'}
          </button>
        ))}
      </div>
      <div className="pick-list">
        {managers.map((m) => (
          <label key={m}>
            <input type="checkbox" checked={filters.managers.includes(m)} onChange={() => set({ managers: toggle(filters.managers, m) })} />
            {m}
          </label>
        ))}
      </div>

      <h3>Commercial</h3>
      <input className="input" type="search" placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 6 }} />
      <div className="pick-list">
        {people.map((c) => (
          <label key={c.id}>
            <input type="checkbox" checked={filters.commerciaux.includes(c.id)} onChange={() => set({ commerciaux: toggle(filters.commerciaux, c.id) })} />
            <span className="swatch" style={{ background: c.couleur, width: 10, height: 10 }} />
            {c.nom}
          </label>
        ))}
        {!people.length && <span className="muted small">Aucun résultat</span>}
      </div>

      <h3>Couverture</h3>
      <div className="row">
        {COUVERTURES.map((c) => (
          <label className="check" key={c}>
            <input type="checkbox" checked={filters.couvertures.includes(c)} onChange={() => set({ couvertures: toggle(filters.couvertures, c) })} />
            {COUVERTURE_LABELS[c]}
          </label>
        ))}
      </div>

      <h3>Statut</h3>
      <label className="check" style={{ marginBottom: 6 }}>
        <input type="checkbox" checked={filters.hideARecruter} onChange={() => set({ hideARecruter: !filters.hideARecruter })} />
        Masquer les « À recruter »
      </label>
      <div className="pick-list">
        {model.statuts.map((s) => (
          <label key={s}>
            <input type="checkbox" checked={filters.statuts.includes(s)} onChange={() => set({ statuts: toggle(filters.statuts, s) })} />
            {s}
          </label>
        ))}
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>
        Sans case cochée, tout est affiché.
      </p>
    </div>
  )
}

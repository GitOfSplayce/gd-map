import { useState } from 'react'
import Icon from '../components/Icon'
import Select from '../components/Select'
import { downloadExcel } from '../lib/excelSheets'
import { exportSheets } from '../lib/exportExcel'
import { availableYears, defaultYear } from '../lib/performance'
import type { MapData } from '../lib/types'

const SHEETS: [string, string][] = [
  ['Commerciaux', 'une ligne par commercial : structures, manager, départements, CA et objectif, coordonnées'],
  ['Départements', 'structure par structure : qui y est, ou « à recruter » avec sa priorité et son secteur'],
  ['CA et objectifs', 'une ligne par commercial, structure et année'],
  ['Managers', 'leurs coordonnées, leurs structures et le CA de leur équipe'],
]

export default function ExportPage({ data }: { data: MapData }) {
  const years = [...new Set([new Date().getFullYear(), ...availableYears(data.objectifs)])].sort((a, b) => b - a)
  const [year, setYear] = useState(() => defaultYear(data.objectifs))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await downloadExcel(exportSheets(data, year), `carte-commerciale-${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header>
        <h1>Export Excel</h1>
        <span className="muted">Réservé aux admins</span>
      </header>
      <div className="card stack">
        <p className="muted" style={{ margin: 0 }}>
          Un classeur mis en forme, avec des filtres sur chaque feuille :
        </p>
        <ul className="export-sheets">
          {SHEETS.map(([name, detail]) => (
            <li key={name}>
              <strong>{name}</strong> : {detail}
            </li>
          ))}
        </ul>
        <div className="row">
          <span className="muted small">CA et objectifs de</span>
          <Select
            className="auto year-select"
            ariaLabel="Année des CA et objectifs"
            value={String(year)}
            options={years.map((y) => ({ value: String(y), label: String(y) }))}
            onChange={(v) => setYear(Number(v))}
            searchable={false}
          />
          <button type="button" className="btn primary" disabled={busy} onClick={() => void run()}>
            <Icon name={busy ? 'refresh' : 'download'} size={16} className={busy ? 'spin' : undefined} />
            Télécharger l'Excel
          </button>
        </div>
        {error && (
          <div className="alert error">
            <Icon name="alert" size={16} />
            {error}
          </div>
        )}
        <p className="muted small" style={{ margin: 0 }}>
          La carte est la source des données : ce fichier sert à les lire et à les partager, il ne se réimporte pas. Il contient des CA et des
          coordonnées : à ne transmettre qu'aux personnes concernées.
        </p>
      </div>
    </>
  )
}

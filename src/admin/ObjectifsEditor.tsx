import { useState } from 'react'
import AmountInput from '../components/AmountInput'
import { PerfBar } from '../components/Legend'
import Select from '../components/Select'
import { parseAmountInput } from '../lib/amounts'
import type { ObjectifsDraft } from '../lib/objectifsDraft'
import { availableYears, defaultYear } from '../lib/performance'
import type { Objectif, Structure } from '../lib/types'

interface Props {
  value: ObjectifsDraft
  /** Tous les chiffres connus, pour les années proposées. */
  known: Objectif[]
  structures: Structure[]
  onChange: (value: ObjectifsDraft) => void
  note: string
}

/** Saisie du CA et de l'objectif par structure, pour l'année choisie. */
export default function ObjectifsEditor({ value, known, structures, onChange, note }: Props) {
  const now = new Date().getFullYear()
  const [year, setYear] = useState(() => defaultYear(known))
  const years = [...new Set([now - 1, now, now + 1, ...availableYears(known), ...Object.keys(value).map(Number)])].sort((a, b) => b - a)

  const setValue = (s: Structure, field: 'ca' | 'objectif', text: string) => {
    const current = value[year]?.[s] ?? { ca: '', objectif: '' }
    onChange({ ...value, [year]: { ...value[year], [s]: { ...current, [field]: text } } })
  }

  return (
    <div className="objectifs-editor">
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="muted small">Année</span>
        <Select
          className="auto year-select"
          ariaLabel="Année des CA et objectifs"
          value={String(year)}
          options={years.map((y) => ({ value: String(y), label: String(y) }))}
          onChange={(v) => setYear(Number(v))}
          searchable={false}
        />
        <span className="muted small">{note}</span>
      </div>
      {!structures.length ? (
        <p className="muted small">Cochez une structure (ou saisissez des zones) pour renseigner son CA.</p>
      ) : (
        <>
          <table className="obj-table">
            <thead>
              <tr>
                <th>Structure</th>
                <th>CA {year}</th>
                <th>Objectif {year}</th>
                <th>Atteint</th>
              </tr>
            </thead>
            <tbody>
              {structures.map((s) => {
                const v = value[year]?.[s] ?? { ca: '', objectif: '' }
                const ca = parseAmountInput(v.ca)
                const obj = parseAmountInput(v.objectif)
                const valid = ca !== null && obj !== null && !Number.isNaN(ca) && !Number.isNaN(obj) && obj > 0
                return (
                  <tr key={s}>
                    <td>
                      <span className="struct-tag">{s}</span>
                    </td>
                    <td>
                      <AmountInput value={v.ca} onChange={(text) => setValue(s, 'ca', text)} ariaLabel={`CA ${s} ${year}`} />
                    </td>
                    <td>
                      <AmountInput value={v.objectif} onChange={(text) => setValue(s, 'objectif', text)} ariaLabel={`Objectif ${s} ${year}`} />
                    </td>
                    <td>{valid ? <PerfBar perf={{ ca: ca!, objectif: obj!, pct: ca! / obj!, hasData: true }} /> : <span className="muted">—</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="muted small amount-hint">
            Saisie rapide : <code>120k</code> = 120 000 €, <code>1,2M</code> = 1 200 000 €.
          </p>
        </>
      )}
    </div>
  )
}

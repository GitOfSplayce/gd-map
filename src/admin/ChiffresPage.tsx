import { useMemo, useState } from 'react'
import AmountInput from '../components/AmountInput'
import Icon from '../components/Icon'
import { PerfBar } from '../components/Legend'
import Select from '../components/Select'
import { saveEquipe } from '../lib/api'
import { formatAmountInput, parseAmountInput } from '../lib/amounts'
import { myStructures, teamOf } from '../lib/equipe'
import { availableYears, defaultYear } from '../lib/performance'
import { plural } from '../lib/text'
import type { Structure } from '../lib/types'
import type { AdminDataProps } from './AdminApp'

// Saisie rapide d'un manager : le CA et l'objectif de toute son équipe pour une année, en un tableau.

type Amounts = { ca: string; objectif: string }

const amountText = (n: number | null | undefined) => (n === null || n === undefined ? '' : formatAmountInput(Number(n)))
const keyOf = (id: string, structure: Structure, annee: number) => `${id}|${structure}|${annee}`
const EMPTY: Amounts = { ca: '', objectif: '' }

export default function ChiffresPage({ data, reload }: AdminDataProps) {
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [year, setYear] = useState(() => defaultYear(data.objectifs))
  const [drafts, setDrafts] = useState<Record<string, Amounts>>({})
  const [busy, setBusy] = useState(false)
  const team = teamOf(data)

  /** Valeurs enregistrées, en texte (« 120 000 »), pour comparer à la saisie. */
  const saved = useMemo(() => {
    const out: Record<string, Amounts> = {}
    for (const o of data.objectifs) out[keyOf(o.commercial_id, o.structure, o.annee)] = { ca: amountText(o.ca), objectif: amountText(o.objectif) }
    return out
  }, [data.objectifs])

  const valueOf = (key: string): Amounts => drafts[key] ?? saved[key] ?? EMPTY
  const dirtyKeys = Object.keys(drafts).filter((key) => {
    const before = saved[key] ?? EMPTY
    return drafts[key].ca.trim() !== before.ca.trim() || drafts[key].objectif.trim() !== before.objectif.trim()
  })

  const now = new Date().getFullYear()
  const years = [...new Set([now - 1, now, now + 1, ...availableYears(data.objectifs)])].sort((a, b) => b - a)

  const set = (key: string, field: keyof Amounts, text: string) => {
    setNotice(null)
    setDrafts((d) => ({ ...d, [key]: { ...valueOf(key), [field]: text } }))
  }

  const save = async () => {
    setError(null)
    setNotice(null)
    const byCommercial = new Map<string, { structure: Structure; annee: number; ca: number | null; objectif: number | null }[]>()
    for (const key of dirtyKeys) {
      const [id, structure, annee] = key.split('|')
      const v = drafts[key]
      const ca = parseAmountInput(v.ca)
      const objectif = parseAmountInput(v.objectif)
      const nom = team.find((c) => c.id === id)?.nom ?? id
      if (Number.isNaN(ca)) return setError(`CA ${structure} ${annee} de ${nom} : « ${v.ca} » n'est pas un montant (ex. 120k, 1,2M ou 120 000).`)
      if (Number.isNaN(objectif)) return setError(`Objectif ${structure} ${annee} de ${nom} : « ${v.objectif} » n'est pas un montant (ex. 120k, 1,2M ou 120 000).`)
      byCommercial.set(id, [...(byCommercial.get(id) ?? []), { structure, annee: Number(annee), ca, objectif }])
    }
    setBusy(true)
    try {
      for (const [id, objectifs] of byCommercial) await saveEquipe(id, { objectifs })
      await reload()
      setDrafts({})
      setNotice(`Chiffres enregistrés pour ${plural(byCommercial.size, 'commercial', 'commerciaux')}.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header>
        <h1>CA et objectifs</h1>
      </header>
      <div className="card stack">
        <div className="row">
          <span className="muted small">Année</span>
          <Select
            className="auto year-select"
            ariaLabel="Année des CA et objectifs"
            value={String(year)}
            options={years.map((y) => ({ value: String(y), label: String(y) }))}
            onChange={(v) => setYear(Number(v))}
            searchable={false}
          />
          <span className="muted small">Vus des admins et des managers, jamais avec le seul code d'accès.</span>
          <span className="grow" />
          {dirtyKeys.length > 0 && (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setDrafts({})}>
              Annuler
            </button>
          )}
          <button type="button" className="btn primary" disabled={busy || !dirtyKeys.length} onClick={() => void save()}>
            <Icon name={busy ? 'refresh' : 'save'} size={16} className={busy ? 'spin' : undefined} />
            {dirtyKeys.length ? `Enregistrer (${dirtyKeys.length})` : 'Enregistré'}
          </button>
        </div>
        {error && (
          <div className="alert error" role="alert">
            <Icon name="alert" size={16} />
            {error}
          </div>
        )}
        {notice && (
          <div className="alert success">
            <Icon name="check" size={16} />
            {notice}
          </div>
        )}

        {team.length > 0 ? (
          <div className="table-wrap">
            <table className="grid obj-table">
              <thead>
                <tr>
                  <th style={{ minWidth: 220 }}>Commercial</th>
                  <th>Structure</th>
                  <th style={{ width: 200 }}>CA {year}</th>
                  <th style={{ width: 200 }}>Objectif {year}</th>
                  <th>Atteint</th>
                </tr>
              </thead>
              <tbody>
                {team.flatMap((c) => {
                  const list = myStructures(data, c)
                  const name = (
                    <td rowSpan={Math.max(list.length, 1)}>
                      <span className="swatch" style={{ background: c.couleur, verticalAlign: 'middle' }} aria-hidden="true" /> <strong>{c.nom}</strong>{' '}
                      {!c.actif && <span className="badge warning">inactif</span>}
                    </td>
                  )
                  if (!list.length) {
                    return [
                      <tr key={c.id}>
                        {name}
                        <td colSpan={4} className="muted small">
                          Aucune de vos structures : un admin doit la cocher pour ce commercial.
                        </td>
                      </tr>,
                    ]
                  }
                  return list.map((s, i) => {
                    const key = keyOf(c.id, s, year)
                    const v = valueOf(key)
                    const ca = parseAmountInput(v.ca)
                    const obj = parseAmountInput(v.objectif)
                    const valid = ca !== null && obj !== null && !Number.isNaN(ca) && !Number.isNaN(obj) && obj > 0
                    return (
                      <tr key={key} className={dirtyKeys.includes(key) ? 'dirty' : undefined}>
                        {i === 0 && name}
                        <td>
                          <span className="struct-tag">{s}</span>
                        </td>
                        <td>
                          <AmountInput value={v.ca} onChange={(t) => set(key, 'ca', t)} ariaLabel={`CA ${s} ${year} de ${c.nom}`} />
                        </td>
                        <td>
                          <AmountInput value={v.objectif} onChange={(t) => set(key, 'objectif', t)} ariaLabel={`Objectif ${s} ${year} de ${c.nom}`} />
                        </td>
                        <td>{valid ? <PerfBar perf={{ ca: ca!, objectif: obj!, pct: ca! / obj!, hasData: true }} /> : <span className="muted">—</span>}</td>
                      </tr>
                    )
                  })
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Aucun commercial dans votre équipe.</p>
        )}
        <p className="muted small amount-hint" style={{ margin: 0 }}>
          Saisie rapide : <code>120k</code> = 120 000 €, <code>1,2M</code> = 1 200 000 €. Vider les deux cases efface la ligne.
        </p>
      </div>
    </>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import AmountInput from '../components/AmountInput'
import Icon from '../components/Icon'
import { PerfBar } from '../components/Legend'
import Select from '../components/Select'
import { fetchEquipe, saveObjectifsEquipe, type Equipe } from '../lib/api'
import { formatAmountInput, parseAmountInput } from '../lib/amounts'
import { availableYears, defaultYear } from '../lib/performance'
import { sortStructures } from '../lib/structures'
import { plural } from '../lib/text'
import type { Structure } from '../lib/types'

// Espace d'un responsable (D-009) : le CA et l'objectif des commerciaux de ses managers, par structure
// et par année. Rien d'autre ne se modifie ici ; la base vérifie que chaque commercial est de l'équipe.

type Amounts = { ca: string; objectif: string }

const amountText = (n: number | null | undefined) => (n === null || n === undefined ? '' : formatAmountInput(Number(n)))
const keyOf = (id: string, structure: Structure, annee: number) => `${id}|${structure}|${annee}`

export default function EquipePage() {
  const [equipe, setEquipe] = useState<Equipe | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Amounts>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const next = await fetchEquipe()
      setEquipe(next)
      setDrafts({})
      setYear((y) => y ?? defaultYear(next.objectifs))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  /** Valeurs enregistrées, en texte (« 120 000 »), pour comparer à la saisie. */
  const saved = useMemo(() => {
    const out: Record<string, Amounts> = {}
    for (const o of equipe?.objectifs ?? []) out[keyOf(o.commercial_id, o.structure, o.annee)] = { ca: amountText(o.ca), objectif: amountText(o.objectif) }
    return out
  }, [equipe])

  const valueOf = (key: string): Amounts => drafts[key] ?? saved[key] ?? { ca: '', objectif: '' }
  const dirtyKeys = Object.keys(drafts).filter((key) => {
    const before = saved[key] ?? { ca: '', objectif: '' }
    return drafts[key].ca.trim() !== before.ca.trim() || drafts[key].objectif.trim() !== before.objectif.trim()
  })

  if (error && !equipe) return <div className="alert error">{error}</div>
  if (!equipe || year === null) return <p className="muted">Chargement…</p>

  const now = new Date().getFullYear()
  const years = [...new Set([now - 1, now, now + 1, ...availableYears(equipe.objectifs)])].sort((a, b) => b - a)
  const order = sortStructures(equipe.structures).map((s) => s.code)
  const structuresOf = (list: Structure[]) => [...list].sort((a, b) => order.indexOf(a) - order.indexOf(b))

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
      const nom = equipe.commerciaux.find((c) => c.id === id)?.nom ?? id
      if (Number.isNaN(ca)) return setError(`CA ${structure} ${annee} de ${nom} : « ${v.ca} » n'est pas un montant (ex. 120k, 1,2M ou 120 000).`)
      if (Number.isNaN(objectif)) return setError(`Objectif ${structure} ${annee} de ${nom} : « ${v.objectif} » n'est pas un montant (ex. 120k, 1,2M ou 120 000).`)
      const list = byCommercial.get(id) ?? []
      list.push({ structure, annee: Number(annee), ca, objectif })
      byCommercial.set(id, list)
    }
    setBusy(true)
    try {
      for (const [id, objectifs] of byCommercial) await saveObjectifsEquipe(id, objectifs)
      await load()
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
        <h1>Chiffres de l'équipe</h1>
      </header>
      <div className="card stack">
        <p className="muted" style={{ margin: 0 }}>
          {equipe.managers.length
            ? `Commerciaux de ${equipe.managers.join(', ')} (Manager 1 ou Manager 2) : ${plural(equipe.commerciaux.length, 'commercial', 'commerciaux')}.`
            : 'Aucun manager dans votre périmètre : demandez à un admin de le compléter.'}{' '}
          Le CA et l'objectif ne sont visibles que des admins et de vous, jamais avec le code d'accès.
        </p>
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
          <span style={{ flex: 1 }} />
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

        {equipe.commerciaux.length > 0 && (
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
                {equipe.commerciaux.flatMap((c) => {
                  const list = structuresOf(c.structures)
                  const name = (
                    <td rowSpan={Math.max(list.length, 1)}>
                      <span className="swatch" style={{ background: c.couleur, verticalAlign: 'middle' }} aria-hidden="true" /> <strong>{c.nom}</strong>{' '}
                      {!c.actif && <span className="badge warning">inactif</span>}
                      <div className="muted small">{[c.manager1, c.manager2].filter(Boolean).join(' · ')}</div>
                    </td>
                  )
                  if (!list.length) {
                    return [
                      <tr key={c.id}>
                        {name}
                        <td colSpan={4} className="muted small">
                          Aucune structure : un admin doit la cocher pour que le CA se saisisse.
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
        )}
        <p className="muted small amount-hint" style={{ margin: 0 }}>
          Saisie rapide : <code>120k</code> = 120 000 €, <code>1,2M</code> = 1 200 000 €. Vider les deux cases efface la ligne.
        </p>
      </div>
    </>
  )
}

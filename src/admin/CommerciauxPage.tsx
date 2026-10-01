import { Fragment, useEffect, useMemo, useState } from 'react'
import { deleteCommercial, saveCommercial } from '../lib/api'
import { isHexColor, pickDistinctColor } from '../lib/colors'
import { formatZoneList, parseZoneList } from '../lib/parseZones'
import { STRUCTURES, type Commercial, type CommercialPayload, type MapData, type Structure } from '../lib/types'
import Icon from '../components/Icon'
import Switch from '../components/Switch'
import type { AdminDataProps } from './AdminApp'
import ZoneInput from './ZoneInput'

interface Row {
  rowKey: string
  id?: string
  nom: string
  statut: string
  manager1: string
  manager2: string
  couleur: string
  actif: boolean
  notes: string
  structures: Structure[]
  jours_an: string
  date_manager1: string
  date_manager2: string
  actions: string
  secteur: string
  ordre: number
  zones: Record<Structure, string>
  dirty: boolean
  saving: boolean
  error: string | null
}

function toRow(c: Commercial, data: MapData): Row {
  const own = data.affectations.filter((a) => a.commercial_id === c.id)
  return {
    rowKey: c.id,
    id: c.id,
    nom: c.nom,
    statut: c.statut ?? '',
    manager1: c.manager1 ?? '',
    manager2: c.manager2 ?? '',
    couleur: c.couleur,
    actif: c.actif,
    notes: c.notes ?? '',
    structures: c.structures,
    jours_an: c.jours_an === null || c.jours_an === undefined ? '' : String(c.jours_an),
    date_manager1: c.date_manager1 ?? '',
    date_manager2: c.date_manager2 ?? '',
    actions: c.actions ?? '',
    secteur: c.secteur ?? '',
    ordre: c.ordre,
    zones: Object.fromEntries(STRUCTURES.map((s) => [s, formatZoneList(own.filter((a) => a.structure === s))])) as Record<Structure, string>,
    dirty: false,
    saving: false,
    error: null,
  }
}

function toPayload(r: Row): CommercialPayload {
  const affectations = STRUCTURES.flatMap((s) =>
    parseZoneList(r.zones[s]).zones.map((z) => ({ structure: s, zone_code: z.code, couverture: z.couverture })),
  )
  const jours = r.jours_an.trim() === '' ? null : Number(r.jours_an.replace(',', '.'))
  return {
    id: r.id,
    nom: r.nom.trim(),
    statut: r.statut,
    manager1: r.manager1,
    manager2: r.manager2,
    couleur: r.couleur,
    actif: r.actif,
    notes: r.notes,
    structures: STRUCTURES.filter((s) => r.structures.includes(s) || r.zones[s].trim() !== ''),
    jours_an: jours !== null && Number.isFinite(jours) ? jours : null,
    date_manager1: r.date_manager1,
    date_manager2: r.date_manager2,
    actions: r.actions,
    secteur: r.secteur,
    ordre: r.ordre,
    affectations,
  }
}

function validate(r: Row): string | null {
  if (!r.nom.trim()) return 'Le nom est obligatoire.'
  if (!isHexColor(r.couleur)) return 'Couleur invalide.'
  for (const s of STRUCTURES) {
    const bad = parseZoneList(r.zones[s]).issues.filter((i) => i.level === 'error')
    if (bad.length) return `Zones ${s} : ${bad.map((i) => i.raw).join(', ')} inconnue(s).`
  }
  if (r.jours_an.trim() && !Number.isFinite(Number(r.jours_an.replace(',', '.')))) return '« Nb de jour / an » doit être un nombre.'
  return null
}

let newKey = 0

export default function CommerciauxPage({ data, reload }: AdminDataProps) {
  const [rows, setRows] = useState<Row[]>(() => data.commerciaux.map((c) => toRow(c, data)))
  const [search, setSearch] = useState('')
  const [structureFilter, setStructureFilter] = useState<Structure | 'ALL'>('ALL')
  const [showInactive, setShowInactive] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)

  // Données rechargées : on garde les lignes en cours de modification et les nouvelles lignes non enregistrées
  useEffect(() => {
    setRows((prev) => {
      const pending = new Map(prev.filter((r) => r.dirty).map((r) => [r.rowKey, r]))
      const fresh = data.commerciaux.map((c) => pending.get(c.id) ?? toRow(c, data))
      const unsaved = prev.filter((r) => !r.id && r.dirty)
      return [...unsaved, ...fresh]
    })
  }, [data])

  const suggestions = useMemo(() => {
    const uniq = (list: (string | null | undefined)[]) => [...new Set(list.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'fr'))
    return {
      statut: uniq(['VRP', 'Agent commercial', 'ATC', 'À recruter', ...data.commerciaux.map((c) => c.statut)]),
      managers: uniq(data.commerciaux.flatMap((c) => [c.manager1, c.manager2])),
    }
  }, [data])

  const update = (rowKey: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.rowKey === rowKey ? { ...r, ...patch, dirty: true, error: null } : r)))

  const setZones = (r: Row, s: Structure, value: string) =>
    update(r.rowKey, {
      zones: { ...r.zones, [s]: value },
      structures: value.trim() && !r.structures.includes(s) ? [...r.structures, s] : r.structures,
    })

  const toggleStructure = (r: Row, s: Structure) =>
    update(r.rowKey, { structures: r.structures.includes(s) ? r.structures.filter((x) => x !== s) : [...r.structures, s] })

  const save = async (r: Row) => {
    const error = validate(r)
    if (error) {
      setRows((prev) => prev.map((x) => (x.rowKey === r.rowKey ? { ...x, error } : x)))
      return false
    }
    setRows((prev) => prev.map((x) => (x.rowKey === r.rowKey ? { ...x, saving: true } : x)))
    try {
      const id = await saveCommercial(toPayload(r))
      setRows((prev) => prev.map((x) => (x.rowKey === r.rowKey ? { ...x, id, rowKey: id, dirty: false, saving: false } : x)))
      return true
    } catch (e) {
      setRows((prev) => prev.map((x) => (x.rowKey === r.rowKey ? { ...x, saving: false, error: (e as Error).message } : x)))
      return false
    }
  }

  const saveAll = async () => {
    const dirty = rows.filter((r) => r.dirty)
    let ok = 0
    for (const r of dirty) if (await save(r)) ok++
    setNotice(`${ok} commercial(aux) enregistré(s)${ok < dirty.length ? `, ${dirty.length - ok} en erreur` : ''}.`)
    await reload()
  }

  const remove = async (r: Row) => {
    if (!r.id) {
      setRows((prev) => prev.filter((x) => x.rowKey !== r.rowKey))
      return
    }
    if (!confirm(`Supprimer ${r.nom} et toutes ses zones ? Cette action est définitive.`)) return
    try {
      await deleteCommercial(r.id)
      setRows((prev) => prev.filter((x) => x.rowKey !== r.rowKey))
      await reload()
    } catch (e) {
      setRows((prev) => prev.map((x) => (x.rowKey === r.rowKey ? { ...x, error: (e as Error).message } : x)))
    }
  }

  const add = () => {
    const rowKey = `new-${++newKey}`
    const row: Row = {
      rowKey,
      nom: '',
      statut: '',
      manager1: '',
      manager2: '',
      couleur: pickDistinctColor(rows.map((r) => r.couleur)),
      actif: true,
      notes: '',
      structures: structureFilter === 'ALL' ? [] : [structureFilter],
      jours_an: '',
      date_manager1: '',
      date_manager2: '',
      actions: '',
      secteur: '',
      ordre: Math.max(0, ...rows.map((r) => r.ordre)) + 1,
      zones: { MD: '', SP: '', MC: '', BK: '' },
      dirty: true,
      saving: false,
      error: null,
    }
    setRows((prev) => [row, ...prev])
    setSearch('')
  }

  const q = search.trim().toLowerCase()
  const visible = rows.filter(
    (r) =>
      (!q || [r.nom, r.statut, r.manager1, r.manager2, r.secteur, ...Object.values(r.zones)].join(' ').toLowerCase().includes(q)) &&
      (structureFilter === 'ALL' || r.structures.includes(structureFilter) || !r.id) &&
      (showInactive || r.actif),
  )
  const dirtyCount = rows.filter((r) => r.dirty).length

  return (
    <>
      <header>
        <h1>Commerciaux</h1>
        <span className="muted">{data.commerciaux.length} au total</span>
      </header>

      <div className="toolbar-row">
        <button type="button" className="btn primary" onClick={add}>
          <Icon name="plus" size={16} />
          Ajouter
        </button>
        <div className="input-icon">
          <Icon name="search" size={16} />
          <input className="input" type="search" placeholder="Rechercher (nom, manager, zone…)" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="seg">
          {(['ALL', ...STRUCTURES] as const).map((s) => (
            <button key={s} type="button" aria-pressed={structureFilter === s} onClick={() => setStructureFilter(s)}>
              {s === 'ALL' ? 'Toutes' : s}
            </button>
          ))}
        </div>
        <Switch checked={showInactive} onChange={setShowInactive} label="Afficher les inactifs" />
        <span className="grow" />
        {dirtyCount > 0 && (
          <button type="button" className="btn accent" onClick={() => void saveAll()}>
            <Icon name="save" size={16} />
            Enregistrer les modifications ({dirtyCount})
          </button>
        )}
      </div>

      {notice && (
        <div className="alert success" style={{ marginBottom: 12 }} onClick={() => setNotice(null)}>
          <Icon name="check" size={16} />
          {notice}
        </div>
      )}

      <p className="muted small">
        Zones au format Excel : <code>22, 35P, 52G, 75-7</code> (P = partiel, G = gestion, 75 = tout Paris, 20 = 2A + 2B). Les
        cases MD / SP / MC / BK indiquent l'appartenance à la structure.
      </p>

      <datalist id="statuts">
        {suggestions.statut.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id="managers">
        {suggestions.managers.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <div className="table-wrap">
        <table className="grid sticky-cols">
          <thead>
            <tr>
              <th>Couleur</th>
              <th className="col-name">Nom</th>
              <th className="col-small">Statut</th>
              <th className="col-small">Manager 1</th>
              <th className="col-small">Manager 2</th>
              {STRUCTURES.map((s) => (
                <th key={s} className="col-zones">
                  {s}
                </th>
              ))}
              <th>Actif</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <Fragment key={r.rowKey}>
                <tr className={(r.dirty ? 'dirty ' : '') + (r.actif ? '' : 'inactive')}>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap', gap: 4 }}>
                      <input
                        type="color"
                        className="color-input"
                        value={isHexColor(r.couleur) ? r.couleur : '#888888'}
                        onChange={(e) => update(r.rowKey, { couleur: e.target.value })}
                        aria-label={`Couleur de ${r.nom}`}
                      />
                      <button
                        type="button"
                        className="btn ghost small icon"
                        title="Nouvelle couleur automatique"
                        aria-label="Nouvelle couleur automatique"
                        onClick={() => update(r.rowKey, { couleur: pickDistinctColor(rows.filter((x) => x !== r).map((x) => x.couleur)) })}
                      >
                        <Icon name="shuffle" size={15} />
                      </button>
                    </div>
                  </td>
                  <td>
                    <input className="input" value={r.nom} onChange={(e) => update(r.rowKey, { nom: e.target.value })} placeholder="Nom" aria-label="Nom" />
                    {r.error && <div className="small" style={{ color: 'var(--danger)', marginTop: 4 }}>{r.error}</div>}
                  </td>
                  <td>
                    <input className="input" list="statuts" value={r.statut} onChange={(e) => update(r.rowKey, { statut: e.target.value })} aria-label="Statut" />
                  </td>
                  <td>
                    <input className="input" list="managers" value={r.manager1} onChange={(e) => update(r.rowKey, { manager1: e.target.value })} aria-label="Manager 1" />
                  </td>
                  <td>
                    <input className="input" list="managers" value={r.manager2} onChange={(e) => update(r.rowKey, { manager2: e.target.value })} aria-label="Manager 2" />
                  </td>
                  {STRUCTURES.map((s) => (
                    <td key={s}>
                      <label className="check small" style={{ marginBottom: 4 }}>
                        <input type="checkbox" checked={r.structures.includes(s)} onChange={() => toggleStructure(r, s)} />
                        {s}
                      </label>
                      <ZoneInput value={r.zones[s]} onChange={(v) => setZones(r, s, v)} label={`Zones ${s} de ${r.nom}`} />
                    </td>
                  ))}
                  <td>
                    <input type="checkbox" checked={r.actif} onChange={(e) => update(r.rowKey, { actif: e.target.checked })} aria-label="Actif" />
                  </td>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev)
                            if (next.has(r.rowKey)) next.delete(r.rowKey)
                            else next.add(r.rowKey)
                            return next
                          })
                        }
                        aria-expanded={expanded.has(r.rowKey)}
                      >
                        <Icon name={expanded.has(r.rowKey) ? 'chevronDown' : 'chevronRight'} size={15} />
                        Détails
                      </button>
                      {r.dirty && (
                        <button type="button" className="btn small primary" disabled={r.saving} onClick={async () => {
                          if (await save(r)) await reload()
                        }}>
                          <Icon name={r.saving ? 'refresh' : 'save'} size={15} className={r.saving ? 'spin' : undefined} />
                          Enregistrer
                        </button>
                      )}
                      <button type="button" className="btn small danger icon" onClick={() => void remove(r)} title="Supprimer" aria-label={`Supprimer ${r.nom}`}>
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
                {expanded.has(r.rowKey) && (
                  <tr className="details">
                    <td colSpan={11}>
                      <div className="details-grid">
                        <label className="field">
                          <span>Nb de jour / an</span>
                          <input className="input" inputMode="decimal" value={r.jours_an} onChange={(e) => update(r.rowKey, { jours_an: e.target.value })} />
                        </label>
                        <label className="field">
                          <span>Date 1</span>
                          <input className="input" value={r.date_manager1} onChange={(e) => update(r.rowKey, { date_manager1: e.target.value })} />
                        </label>
                        <label className="field">
                          <span>Date 2</span>
                          <input className="input" value={r.date_manager2} onChange={(e) => update(r.rowKey, { date_manager2: e.target.value })} />
                        </label>
                        <label className="field">
                          <span>Région (secteur)</span>
                          <input className="input" value={r.secteur} onChange={(e) => update(r.rowKey, { secteur: e.target.value })} />
                        </label>
                        <label className="field wide">
                          <span>Actions</span>
                          <input className="input" value={r.actions} onChange={(e) => update(r.rowKey, { actions: e.target.value })} />
                        </label>
                        <label className="field wide">
                          <span>Notes (visibles des admins uniquement)</span>
                          <textarea className="textarea" value={r.notes} onChange={(e) => update(r.rowKey, { notes: e.target.value })} />
                        </label>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={11} className="muted">
                  Aucun commercial. Ajoutez-en un ou importez le fichier Excel.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

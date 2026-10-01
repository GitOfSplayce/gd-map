import { useEffect, useMemo, useState, type FormEvent } from 'react'
import Icon from '../components/Icon'
import Switch from '../components/Switch'
import { deleteCommercial, saveCommercial } from '../lib/api'
import { isHexColor, pickDistinctColor } from '../lib/colors'
import { isARecruter } from '../lib/mapModel'
import { formatZoneList, parseZoneList } from '../lib/parseZones'
import { plural } from '../lib/text'
import { STRUCTURE_LABELS, STRUCTURES, type Commercial, type CommercialPayload, type MapData, type Structure } from '../lib/types'
import type { AdminDataProps } from './AdminApp'
import ZoneInput from './ZoneInput'

/** Formulaire d'un commercial (valeurs texte, telles que saisies). */
interface Draft {
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
}

const zoneTexts = (c: Commercial, data: MapData) => {
  const own = data.affectations.filter((a) => a.commercial_id === c.id)
  return Object.fromEntries(STRUCTURES.map((s) => [s, formatZoneList(own.filter((a) => a.structure === s))])) as Record<Structure, string>
}

function toDraft(c: Commercial, data: MapData): Draft {
  return {
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
    zones: zoneTexts(c, data),
  }
}

function toPayload(d: Draft): CommercialPayload {
  const affectations = STRUCTURES.flatMap((s) =>
    parseZoneList(d.zones[s]).zones.map((z) => ({ structure: s, zone_code: z.code, couverture: z.couverture })),
  )
  const jours = d.jours_an.trim() === '' ? null : Number(d.jours_an.replace(',', '.'))
  return {
    id: d.id,
    nom: d.nom.trim(),
    statut: d.statut,
    manager1: d.manager1,
    manager2: d.manager2,
    couleur: d.couleur,
    actif: d.actif,
    notes: d.notes,
    structures: STRUCTURES.filter((s) => d.structures.includes(s) || d.zones[s].trim() !== ''),
    jours_an: jours !== null && Number.isFinite(jours) ? jours : null,
    date_manager1: d.date_manager1,
    date_manager2: d.date_manager2,
    actions: d.actions,
    secteur: d.secteur,
    ordre: d.ordre,
    affectations,
  }
}

function validate(d: Draft): string | null {
  if (!d.nom.trim()) return 'Le nom est obligatoire.'
  if (!isHexColor(d.couleur)) return 'Couleur invalide.'
  for (const s of STRUCTURES) {
    const bad = parseZoneList(d.zones[s]).issues.filter((i) => i.level === 'error')
    if (bad.length === 1) return `Zones ${s} : « ${bad[0].raw} » n'est pas une zone connue.`
    if (bad.length > 1) return `Zones ${s} : ${bad.map((i) => `« ${i.raw} »`).join(', ')} ne sont pas des zones connues.`
  }
  if (d.jours_an.trim() && !Number.isFinite(Number(d.jours_an.replace(',', '.')))) return '« Nb de jour / an » doit être un nombre.'
  return null
}

type SortKey = 'ordre' | 'nom' | 'statut' | 'manager1' | 'manager2'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'ordre', label: 'Ordre du fichier' },
  { key: 'nom', label: 'Nom' },
  { key: 'statut', label: 'Statut' },
  { key: 'manager1', label: 'Manager 1' },
  { key: 'manager2', label: 'Manager 2' },
]

export default function CommerciauxPage({ data, reload }: AdminDataProps) {
  const [search, setSearch] = useState('')
  const [structureFilter, setStructureFilter] = useState<Structure | 'ALL'>('ALL')
  const [showInactive, setShowInactive] = useState(true)
  const [sort, setSort] = useState<SortKey>('ordre')
  const [editing, setEditing] = useState<Draft | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const zones = useMemo(() => new Map(data.commerciaux.map((c) => [c.id, zoneTexts(c, data)])), [data])

  const q = search.trim().toLowerCase()
  const rows = data.commerciaux
    .filter(
      (c) =>
        (!q ||
          [c.nom, c.statut, c.manager1, c.manager2, c.secteur, ...Object.values(zones.get(c.id) ?? {})]
            .join(' ')
            .toLowerCase()
            .includes(q)) &&
        (structureFilter === 'ALL' || c.structures.includes(structureFilter)) &&
        (showInactive || c.actif),
    )
    .sort((a, b) => {
      if (sort === 'ordre') return a.ordre - b.ordre || a.nom.localeCompare(b.nom, 'fr')
      return (a[sort] ?? '').localeCompare(b[sort] ?? '', 'fr') || a.nom.localeCompare(b.nom, 'fr')
    })

  const add = () =>
    setEditing({
      nom: '',
      statut: '',
      manager1: '',
      manager2: '',
      couleur: pickDistinctColor(data.commerciaux.map((c) => c.couleur)),
      actif: true,
      notes: '',
      structures: structureFilter === 'ALL' ? [] : [structureFilter],
      jours_an: '',
      date_manager1: '',
      date_manager2: '',
      actions: '',
      secteur: '',
      ordre: Math.max(0, ...data.commerciaux.map((c) => c.ordre)) + 1,
      zones: { MD: '', SP: '', MC: '', BK: '' },
    })

  const remove = async (c: { id?: string; nom: string }) => {
    if (!c.id || !confirm(`Supprimer ${c.nom} et toutes ses zones ? Cette action est définitive.`)) return false
    await deleteCommercial(c.id)
    await reload()
    setNotice(`${c.nom} a été supprimé.`)
    return true
  }

  return (
    <>
      <header>
        <h1>Commerciaux</h1>
        <span className="muted">{plural(data.commerciaux.length, 'commercial', 'commerciaux')}</span>
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
        <label className="row small muted">
          Trier par
          <select className="select" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {notice && (
        <div className="alert success" style={{ marginBottom: 12 }} onClick={() => setNotice(null)}>
          <Icon name="check" size={16} />
          {notice}
        </div>
      )}

      <div className="table-wrap">
        <table className="grid list">
          <thead>
            <tr>
              <th>Commercial</th>
              <th>Statut</th>
              <th>Managers</th>
              <th>Zones</th>
              <th className="col-actions">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const z = zones.get(c.id)!
              return (
                <tr
                  key={c.id}
                  className={'clickable' + (c.actif ? '' : ' inactive')}
                  onClick={() => setEditing(toDraft(c, data))}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setEditing(toDraft(c, data))}
                >
                  <td>
                    <div className="who">
                      <span className="swatch" style={{ background: c.couleur }} />
                      <div>
                        <div className="who-name">{c.nom}</div>
                        <div className="who-sub">
                          {[c.secteur, !c.actif && 'inactif'].filter(Boolean).join(' · ') || ' '}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {c.statut ? <span className={'badge' + (isARecruter(c) ? ' warning' : '')}>{c.statut}</span> : <span className="muted">—</span>}
                  </td>
                  <td className="managers">
                    <div>
                      <span className="muted">1</span> {c.manager1 || '—'}
                    </div>
                    <div>
                      <span className="muted">2</span> {c.manager2 || '—'}
                    </div>
                  </td>
                  <td>
                    <div className="zone-summary">
                      {STRUCTURES.filter((s) => c.structures.includes(s) || z[s]).map((s) => (
                        <div key={s}>
                          <span className="struct-tag">{s}</span>
                          <span className={z[s] ? 'zone-text' : 'zone-text muted'}>{z[s] || 'aucune zone'}</span>
                        </div>
                      ))}
                      {!c.structures.length && !STRUCTURES.some((s) => z[s]) && <span className="muted">—</span>}
                    </div>
                  </td>
                  <td className="col-actions">
                    <button
                      type="button"
                      className="btn small ghost icon"
                      title="Modifier"
                      aria-label={`Modifier ${c.nom}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditing(toDraft(c, data))
                      }}
                    >
                      <Icon name="pencil" size={16} />
                    </button>
                  </td>
                </tr>
              )
            })}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="muted">
                  {data.commerciaux.length ? 'Aucun commercial ne correspond à la recherche.' : 'Aucun commercial. Ajoutez-en un ou importez le fichier Excel.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditDrawer
          draft={editing}
          data={data}
          onClose={() => setEditing(null)}
          onSaved={async (nom, created) => {
            await reload()
            setEditing(null)
            setNotice(created ? `${nom} a été ajouté.` : `${nom} a été enregistré.`)
          }}
          onDelete={async (d) => {
            if (await remove(d)) setEditing(null)
          }}
        />
      )}
    </>
  )
}

interface DrawerProps {
  draft: Draft
  data: MapData
  onClose: () => void
  onSaved: (nom: string, created: boolean) => Promise<void>
  onDelete: (d: Draft) => Promise<void>
}

/** Panneau latéral d'édition d'un commercial. */
function EditDrawer({ draft, data, onClose, onSaved, onDelete }: DrawerProps) {
  const [d, setD] = useState<Draft>(draft)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const suggestions = useMemo(() => {
    const uniq = (list: (string | null | undefined)[]) => [...new Set(list.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'fr'))
    return {
      statut: uniq(['VRP', 'Agent commercial', 'ATC', 'À recruter', ...data.commerciaux.map((c) => c.statut)]),
      managers: uniq(data.commerciaux.flatMap((c) => [c.manager1, c.manager2])),
    }
  }, [data])

  const set = (patch: Partial<Draft>) => {
    setD((prev) => ({ ...prev, ...patch }))
    setDirty(true)
    setError(null)
  }

  const close = () => {
    if (dirty && !confirm('Abandonner les modifications non enregistrées ?')) return
    onClose()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const problem = validate(d)
    if (problem) return setError(problem)
    setSaving(true)
    try {
      await saveCommercial(toPayload(d))
      await onSaved(d.nom.trim(), !d.id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const setZones = (s: Structure, value: string) =>
    set({ zones: { ...d.zones, [s]: value }, structures: value.trim() && !d.structures.includes(s) ? [...d.structures, s] : d.structures })

  return (
    <>
      <div className="drawer-backdrop" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={d.id ? `Modifier ${draft.nom}` : 'Nouveau commercial'}>
        <form onSubmit={submit} className="drawer-form">
          <header className="drawer-head">
            <span className="swatch" style={{ background: d.couleur, width: 18, height: 18 }} />
            <h2 className="grow">{d.id ? draft.nom : 'Nouveau commercial'}</h2>
            <button type="button" className="btn small ghost icon" onClick={close} aria-label="Fermer" title="Fermer">
              <Icon name="x" size={18} />
            </button>
          </header>

          <div className="drawer-body">
            <section>
              <h3>Identité</h3>
              <div className="form-grid">
                <label className="field span-2">
                  <span>Nom *</span>
                  <input className="input" value={d.nom} onChange={(e) => set({ nom: e.target.value })} autoFocus={!d.id} required />
                </label>
                <label className="field">
                  <span>Statut</span>
                  <input className="input" list="statuts" value={d.statut} onChange={(e) => set({ statut: e.target.value })} />
                </label>
                <label className="field">
                  <span>Région (secteur)</span>
                  <input className="input" value={d.secteur} onChange={(e) => set({ secteur: e.target.value })} />
                </label>
                <label className="field">
                  <span>Manager 1</span>
                  <input className="input" list="managers" value={d.manager1} onChange={(e) => set({ manager1: e.target.value })} />
                </label>
                <label className="field">
                  <span>Manager 2</span>
                  <input className="input" list="managers" value={d.manager2} onChange={(e) => set({ manager2: e.target.value })} />
                </label>
                <div className="field">
                  <span>Couleur sur la carte</span>
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <input
                      type="color"
                      className="color-input"
                      value={isHexColor(d.couleur) ? d.couleur : '#888888'}
                      onChange={(e) => set({ couleur: e.target.value })}
                      aria-label="Couleur"
                    />
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => set({ couleur: pickDistinctColor(data.commerciaux.filter((c) => c.id !== d.id).map((c) => c.couleur)) })}
                    >
                      <Icon name="shuffle" size={15} />
                      Autre couleur
                    </button>
                  </div>
                </div>
                <div className="field" style={{ justifyContent: 'flex-end' }}>
                  <Switch checked={d.actif} onChange={(on) => set({ actif: on })} label={d.actif ? 'Actif (visible sur la carte)' : 'Inactif (masqué)'} />
                </div>
              </div>
            </section>

            <section>
              <h3>Zones par structure</h3>
              <p className="muted small" style={{ marginTop: 0 }}>
                Format Excel : <code>22, 35P, 52G, 75-7</code> — P = partiel, G = gestion, 75 = tout Paris, 20 = 2A + 2B.
              </p>
              <div className="stack" style={{ gap: 14 }}>
                {STRUCTURES.map((s) => (
                  <div key={s} className="struct-block">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={d.structures.includes(s)}
                        onChange={() => set({ structures: d.structures.includes(s) ? d.structures.filter((x) => x !== s) : [...d.structures, s] })}
                      />
                      <span className="struct-tag">{s}</span>
                      <span>{STRUCTURE_LABELS[s]}</span>
                    </label>
                    <ZoneInput value={d.zones[s]} onChange={(v) => setZones(s, v)} label={`Zones ${s}`} />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3>Suivi</h3>
              <div className="form-grid">
                <label className="field">
                  <span>Nb de jour / an</span>
                  <input className="input" inputMode="decimal" value={d.jours_an} onChange={(e) => set({ jours_an: e.target.value })} />
                </label>
                <span />
                <label className="field">
                  <span>Date 1</span>
                  <input className="input" value={d.date_manager1} onChange={(e) => set({ date_manager1: e.target.value })} />
                </label>
                <label className="field">
                  <span>Date 2</span>
                  <input className="input" value={d.date_manager2} onChange={(e) => set({ date_manager2: e.target.value })} />
                </label>
                <label className="field span-2">
                  <span>Actions</span>
                  <input className="input" value={d.actions} onChange={(e) => set({ actions: e.target.value })} />
                </label>
                <label className="field span-2">
                  <span>Notes (visibles des admins uniquement)</span>
                  <textarea className="textarea" value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
                </label>
              </div>
            </section>

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
          </div>

          <footer className="drawer-foot">
            {error && (
              <div className="alert error">
                <Icon name="alert" size={16} />
                {error}
              </div>
            )}
            <div className="row">
              {d.id && (
                <button type="button" className="btn danger" onClick={() => void onDelete(d)}>
                  <Icon name="trash" size={16} />
                  Supprimer
                </button>
              )}
              <span className="grow" />
              <button type="button" className="btn ghost" onClick={close}>
                Annuler
              </button>
              <button type="submit" className="btn primary" disabled={saving || (!dirty && Boolean(d.id))}>
                <Icon name={saving ? 'refresh' : 'save'} size={16} className={saving ? 'spin' : undefined} />
                {d.id ? 'Enregistrer' : 'Ajouter'}
              </button>
            </div>
          </footer>
        </form>
      </aside>
    </>
  )
}

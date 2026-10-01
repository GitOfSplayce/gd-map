import { useEffect, useMemo, useState, type FormEvent } from 'react'
import AmountInput from '../components/AmountInput'
import ColorPicker from '../components/ColorPicker'
import { PerfBar } from '../components/Legend'
import Icon from '../components/Icon'
import Select from '../components/Select'
import Switch from '../components/Switch'
import { useConfirm } from '../hooks/useConfirm'
import { formatAmountInput, parseAmountInput } from '../lib/amounts'
import { deleteCommercial, saveCommercial } from '../lib/api'
import { isHexColor, managerColors, pickDistinctColor } from '../lib/colors'
import { isARecruter } from '../lib/mapModel'
import { formatZoneList, parseZoneList } from '../lib/parseZones'
import { availableYears, defaultYear } from '../lib/performance'
import { plural } from '../lib/text'
import { statutChoices, statutNormalizer } from '../lib/statuts'
import { structureCodes, structureName } from '../lib/structures'
import type { Commercial, CommercialPayload, MapData, Structure } from '../lib/types'
import type { AdminDataProps } from './AdminApp'
import ZoneAssistant from './ZoneAssistant'
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
  /** CA et objectifs saisis, par année puis par structure (texte tel que tapé). */
  objectifs: Record<number, Partial<Record<Structure, { ca: string; objectif: string }>>>
}

/** « 120k », « 1,2M », « 120 000 € » → nombre ; '' → null ; illisible → NaN. */
const parseAmount = parseAmountInput
const amountText = (n: number | null) => (n === null ? '' : formatAmountInput(Number(n)))

const objectifsDraft = (c: Commercial, data: MapData): Draft['objectifs'] => {
  const out: Draft['objectifs'] = {}
  for (const o of data.objectifs.filter((x) => x.commercial_id === c.id)) {
    out[o.annee] ??= {}
    out[o.annee][o.structure] = { ca: amountText(o.ca), objectif: amountText(o.objectif) }
  }
  return out
}

const zoneTexts = (c: Commercial, data: MapData) => {
  const own = data.affectations.filter((a) => a.commercial_id === c.id)
  return Object.fromEntries(structureCodes(data.structures).map((s) => [s, formatZoneList(own.filter((a) => a.structure === s))])) as Record<
    Structure,
    string
  >
}

/** Texte des zones d'une structure (vide si la structure vient d'être créée). */
const zonesText = (d: Draft, s: Structure) => d.zones[s] ?? ''

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
    objectifs: objectifsDraft(c, data),
  }
}

function toPayload(d: Draft, codes: readonly Structure[]): CommercialPayload {
  const affectations = codes.flatMap((s) =>
    parseZoneList(zonesText(d, s)).zones.map((z) => ({ structure: s, zone_code: z.code, couverture: z.couverture })),
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
    structures: effectiveStructures(d, codes),
    jours_an: jours !== null && Number.isFinite(jours) ? jours : null,
    date_manager1: d.date_manager1,
    date_manager2: d.date_manager2,
    actions: d.actions,
    secteur: d.secteur,
    ordre: d.ordre,
    affectations,
    // Toutes les lignes connues : une ligne vidée (CA et objectif vides) est supprimée côté serveur
    objectifs: Object.entries(d.objectifs).flatMap(([annee, byStructure]) =>
      Object.entries(byStructure).map(([structure, v]) => ({
        structure: structure as Structure,
        annee: Number(annee),
        ca: parseAmount(v!.ca),
        objectif: parseAmount(v!.objectif),
      })),
    ),
  }
}

function validate(d: Draft, codes: readonly Structure[]): string | null {
  if (!d.nom.trim()) return 'Le nom est obligatoire.'
  if (!isHexColor(d.couleur)) return 'Couleur invalide.'
  for (const s of codes) {
    const bad = parseZoneList(zonesText(d, s)).issues.filter((i) => i.level === 'error')
    if (bad.length === 1) return `Zones ${s} : « ${bad[0].raw} » n'est pas une zone connue.`
    if (bad.length > 1) return `Zones ${s} : ${bad.map((i) => `« ${i.raw} »`).join(', ')} ne sont pas des zones connues.`
  }
  if (d.jours_an.trim() && !Number.isFinite(Number(d.jours_an.replace(',', '.')))) return '« Nb de jour / an » doit être un nombre.'
  for (const [annee, byStructure] of Object.entries(d.objectifs)) {
    for (const [s, v] of Object.entries(byStructure)) {
      if (Number.isNaN(parseAmount(v!.ca))) return `CA ${s} ${annee} : « ${v!.ca} » n'est pas un montant (ex. 120k, 1,2M ou 120 000).`
      if (Number.isNaN(parseAmount(v!.objectif))) return `Objectif ${s} ${annee} : « ${v!.objectif} » n'est pas un montant (ex. 120k, 1,2M ou 120 000).`
    }
  }
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
  const codes = useMemo(() => structureCodes(data.structures), [data.structures])
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
      zones: Object.fromEntries(codes.map((s) => [s, ''])),
      objectifs: {},
    })

  const confirm = useConfirm()

  const remove = async (c: { id?: string; nom: string }) => {
    if (!c.id) return false
    const ok = await confirm({
      title: `Supprimer ${c.nom} ?`,
      message: 'Ses zones sont supprimées avec lui. Cette action est définitive.',
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return false
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
          {['ALL', ...codes].map((s) => (
            <button key={s} type="button" aria-pressed={structureFilter === s} onClick={() => setStructureFilter(s)}>
              {s === 'ALL' ? 'Toutes' : s}
            </button>
          ))}
        </div>
        <Switch checked={showInactive} onChange={setShowInactive} label="Afficher les inactifs" />
        <span className="grow" />
        <div className="row small muted">
          Trier par
          <Select
            className="auto"
            ariaLabel="Trier par"
            value={sort}
            options={SORTS.map((x) => ({ value: x.key, label: x.label }))}
            onChange={(v) => setSort(v as SortKey)}
            searchable={false}
          />
        </div>
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
                      {codes.filter((s) => c.structures.includes(s) || z[s]).map((s) => (
                        <div key={s}>
                          <span className="struct-tag">{s}</span>
                          <span className={z[s] ? 'zone-text' : 'zone-text muted'}>{z[s] || 'aucune zone'}</span>
                        </div>
                      ))}
                      {!c.structures.length && !codes.some((s) => z[s]) && <span className="muted">—</span>}
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

/** Structures effectives : cochées, ou ayant des zones saisies. */
const effectiveStructures = (d: Draft, codes: readonly Structure[]) =>
  codes.filter((s) => d.structures.includes(s) || parseZoneList(zonesText(d, s)).zones.length > 0)

/** Forme comparable d'un formulaire : espaces, format des zones et casse de la couleur n'en font pas une modification. */
function fingerprint(d: Draft, codes: readonly Structure[]): string {
  const t = (v: string) => v.trim().replace(/\s+/g, ' ')
  return JSON.stringify({
    nom: t(d.nom),
    statut: t(d.statut),
    manager1: t(d.manager1),
    manager2: t(d.manager2),
    couleur: d.couleur.toLowerCase(),
    actif: d.actif,
    notes: d.notes.trim(),
    structures: effectiveStructures(d, codes),
    jours_an: d.jours_an.trim() === '' ? null : Number(d.jours_an.replace(',', '.')),
    date_manager1: t(d.date_manager1),
    date_manager2: t(d.date_manager2),
    actions: t(d.actions),
    secteur: t(d.secteur),
    objectifs: Object.entries(d.objectifs)
      .flatMap(([annee, byStructure]) =>
        Object.entries(byStructure).map(([st, v]) => [Number(annee), st, parseAmount(v!.ca), parseAmount(v!.objectif)]),
      )
      .filter(([, , ca, obj]) => ca !== null || obj !== null)
      .sort((a, b) => String(a).localeCompare(String(b))),
    zones: codes.map((s) =>
      formatZoneList(parseZoneList(zonesText(d, s)).zones.map((z) => ({ zone_code: z.code, couverture: z.couverture }))),
    ),
  })
}

/** Panneau latéral d'édition d'un commercial. */
function EditDrawer({ draft, data, onClose, onSaved, onDelete }: DrawerProps) {
  const [d, setD] = useState<Draft>(draft)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [assistantFor, setAssistantFor] = useState<Structure | null>(null)
  const confirm = useConfirm()
  const codes = useMemo(() => structureCodes(data.structures), [data.structures])

  const initial = useMemo(() => fingerprint(draft, codes), [draft, codes])
  const dirty = fingerprint(d, codes) !== initial

  // Une seule entrée par statut, quelles que soient la casse et les accents ; l'enregistrement reprend cette écriture
  const statuts = useMemo(() => data.commerciaux.map((c) => c.statut), [data])
  const statutOptions = useMemo(() => statutChoices(statuts).map((v) => ({ value: v, label: v })), [statuts])
  const normStatut = useMemo(() => statutNormalizer(statuts), [statuts])

  const managerOptions = useMemo(() => {
    const colors = managerColors([], data.managers)
    const count = (nom: string) => data.commerciaux.filter((c) => c.manager1 === nom || c.manager2 === nom).length
    return data.managers.map((m) => ({ value: m.nom, label: m.nom, color: colors.get(m.nom), hint: plural(count(m.nom), 'commercial', 'commerciaux') }))
  }, [data])

  const usedColors = useMemo(
    () => data.commerciaux.filter((c) => c.id !== d.id).map((c) => ({ color: c.couleur, owner: c.nom })),
    [data, d.id],
  )

  const set = (patch: Partial<Draft>) => {
    setD((prev) => ({ ...prev, ...patch }))
    setError(null)
  }

  const close = async () => {
    if (dirty) {
      const ok = await confirm({
        title: 'Abandonner les modifications ?',
        message: 'Les changements faits sur ce commercial ne sont pas enregistrés.',
        confirmLabel: 'Abandonner',
        cancelLabel: 'Continuer la saisie',
        danger: true,
      })
      if (!ok) return
    }
    onClose()
  }

  useEffect(() => {
    if (assistantFor) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && void close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const problem = validate(d, codes)
    if (problem) return setError(problem)
    setSaving(true)
    try {
      await saveCommercial({ ...toPayload(d, codes), statut: normStatut(d.statut) })
      await onSaved(d.nom.trim(), !d.id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const structures = effectiveStructures(d, codes)

  return (
    <>
      <div className="drawer-backdrop" onClick={() => void close()} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={d.id ? `Modifier ${draft.nom}` : 'Nouveau commercial'}>
        <form onSubmit={submit} className="drawer-form">
          <header className="drawer-head">
            <span className="swatch" style={{ background: d.couleur, width: 18, height: 18 }} />
            <h2 className="grow">{d.id ? draft.nom : 'Nouveau commercial'}</h2>
            {dirty && <span className="badge warning">Non enregistré</span>}
            <button type="button" className="btn small ghost icon" onClick={() => void close()} aria-label="Fermer" title="Fermer">
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
                <div className="field">
                  <span>Statut</span>
                  <Select
                    ariaLabel="Statut"
                    value={d.statut}
                    options={statutOptions}
                    onChange={(v) => set({ statut: v })}
                    emptyLabel="— Aucun —"
                    creatable
                    createLabel={(t) => `Nouveau statut « ${t} »`}
                  />
                </div>
                <label className="field">
                  <span>Région (secteur)</span>
                  <input className="input" value={d.secteur} onChange={(e) => set({ secteur: e.target.value })} />
                </label>
                <div className="field">
                  <span>Manager 1</span>
                  <Select
                    ariaLabel="Manager 1"
                    value={d.manager1}
                    options={managerOptions}
                    onChange={(v) => set({ manager1: v })}
                    emptyLabel="— Aucun —"
                    creatable
                    createLabel={(t) => `Nouveau manager « ${t} »`}
                  />
                </div>
                <div className="field">
                  <span>Manager 2</span>
                  <Select
                    ariaLabel="Manager 2"
                    value={d.manager2}
                    options={managerOptions}
                    onChange={(v) => set({ manager2: v })}
                    emptyLabel="— Aucun —"
                    creatable
                    createLabel={(t) => `Nouveau manager « ${t} »`}
                  />
                </div>
                <div className="field span-2">
                  <span>Couleur sur la carte</span>
                  <ColorPicker value={d.couleur} onChange={(c) => set({ couleur: c })} used={usedColors} ariaLabel="Couleur sur la carte" />
                </div>
                <div className="field span-2">
                  <Switch checked={d.actif} onChange={(on) => set({ actif: on })} label={d.actif ? 'Actif : visible sur la carte' : 'Inactif : masqué de la carte'} />
                </div>
              </div>
            </section>

            <section>
              <h3>Zones par structure</h3>
              <p className="muted small" style={{ marginTop: 0 }}>
                Saisie au format Excel (<code>22, 35P, 52G, 75-7</code> : P = partiel, G = gestion, 75 = tout Paris) ou avec
                l'assistant.
              </p>
              <div className="stack" style={{ gap: 12 }}>
                {codes.map((s) => {
                  const hasZones = parseZoneList(zonesText(d, s)).zones.length > 0
                  return (
                    <div key={s} className={'struct-block' + (structures.includes(s) ? ' on' : '')}>
                      <div className="struct-head">
                        <label className="check" title={hasZones ? 'Videz les zones pour retirer la structure' : undefined}>
                          <input
                            type="checkbox"
                            checked={structures.includes(s)}
                            disabled={hasZones}
                            onChange={() => set({ structures: d.structures.includes(s) ? d.structures.filter((x) => x !== s) : [...d.structures, s] })}
                          />
                          <span className="struct-tag">{s}</span>
                          <span>{structureName(data.structures, s)}</span>
                        </label>
                        <button type="button" className="btn small" onClick={() => setAssistantFor(s)}>
                          <Icon name="map" size={15} />
                          Assistant
                        </button>
                      </div>
                      <ZoneInput value={zonesText(d, s)} onChange={(v) => set({ zones: { ...d.zones, [s]: v } })} label={`Zones ${s}`} />
                    </div>
                  )
                })}
              </div>
            </section>

            <section>
              <h3>CA et objectifs</h3>
              <ObjectifsEditor d={d} data={data} structures={structures} onChange={(objectifs) => set({ objectifs })} />
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
              <button type="button" className="btn ghost" onClick={() => void close()}>
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

      {assistantFor && (
        <ZoneAssistant
          title={`Zones ${assistantFor} (${structureName(data.structures, assistantFor)}) – ${d.nom.trim() || 'nouveau commercial'}`}
          value={zonesText(d, assistantFor)}
          onApply={(text) => set({ zones: { ...d.zones, [assistantFor]: text } })}
          onClose={() => setAssistantFor(null)}
        />
      )}
    </>
  )
}

/** Saisie du CA et de l'objectif par structure, pour l'année choisie. */
function ObjectifsEditor({
  d,
  data,
  structures,
  onChange,
}: {
  d: Draft
  data: MapData
  structures: Structure[]
  onChange: (objectifs: Draft['objectifs']) => void
}) {
  const now = new Date().getFullYear()
  const [year, setYear] = useState(() => defaultYear(data.objectifs))
  const years = [...new Set([now - 1, now, now + 1, ...availableYears(data.objectifs), ...Object.keys(d.objectifs).map(Number)])].sort((a, b) => b - a)
  const rows = structures.length ? structures : []

  const setValue = (s: Structure, field: 'ca' | 'objectif', value: string) => {
    const current = d.objectifs[year]?.[s] ?? { ca: '', objectif: '' }
    onChange({ ...d.objectifs, [year]: { ...d.objectifs[year], [s]: { ...current, [field]: value } } })
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
        <span className="muted small">Réservé aux admins, jamais visible avec le seul code d'accès.</span>
      </div>
      {!rows.length ? (
        <p className="muted small">Cochez une structure (ou saisissez des zones) pour renseigner son CA.</p>
      ) : (
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
            {rows.map((s) => {
              const v = d.objectifs[year]?.[s] ?? { ca: '', objectif: '' }
              const ca = parseAmount(v.ca)
              const obj = parseAmount(v.objectif)
              const valid = ca !== null && obj !== null && !Number.isNaN(ca) && !Number.isNaN(obj) && obj > 0
              return (
                <tr key={s}>
                  <td>
                    <span className="struct-tag">{s}</span>
                  </td>
                  <td>
                    <AmountInput value={v.ca} onChange={(t) => setValue(s, 'ca', t)} ariaLabel={`CA ${s} ${year}`} />
                  </td>
                  <td>
                    <AmountInput value={v.objectif} onChange={(t) => setValue(s, 'objectif', t)} ariaLabel={`Objectif ${s} ${year}`} />
                  </td>
                  <td>{valid ? <PerfBar perf={{ ca: ca!, objectif: obj!, pct: ca! / obj!, hasData: true }} /> : <span className="muted">—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {rows.length > 0 && (
        <p className="muted small amount-hint">
          Saisie rapide : <code>120k</code> = 120 000 €, <code>1,2M</code> = 1 200 000 €.
        </p>
      )}
    </div>
  )
}

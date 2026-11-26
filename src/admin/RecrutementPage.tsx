import { useMemo, useRef, useState, type FormEvent } from 'react'
import Icon from '../components/Icon'
import { HatchSwatch } from '../components/Legend'
import MapView, { type MapViewMode } from '../components/MapView'
import SearchInput from '../components/SearchInput'
import Sliding from '../components/Sliding'
import Select from '../components/Select'
import { useConfirm } from '../hooks/useConfirm'
import { useGeo } from '../hooks/useGeo'
import { convertirARecruter, saveCommercial, setRecrutement } from '../lib/api'
import { downloadExcel } from '../lib/excelSheets'
import { exportSheets } from '../lib/exportExcel'
import { groupColor, hatchId, recruitOverlay, type MapGroup, type MapModel, type ZoneStyle } from '../lib/mapModel'
import { formatZoneList, parseZoneList } from '../lib/parseZones'
import { defaultYear } from '../lib/performance'
import { PRIORITES, atomsOf, groupLabel, isARecruter, occupancyOf, prioriteColor, prioriteLabel, sectorOf } from '../lib/recrutement'
import { structureCodes, structureName } from '../lib/structures'
import { plural } from '../lib/text'
import { COUVERTURE_LABELS, type Commercial, type MapData, type Priorite, type Structure } from '../lib/types'
import { addZonesToText, coverageIn, selectionFromText } from '../lib/zoneEditing'
import { PARIS_ARR_CODES, ZONES, ZONE_BY_CODE, compareZoneCodes, isParisArr } from '../lib/zones'
import { formatEuros } from '../lib/zoneDetails'
import type { AdminDataProps } from './AdminApp'

/** `secteur` : le groupe du département (les départements d'un même poste). */
type Row = { priorite: Priorite | null; secteur: string | null }
/** null : le pinceau ne touche pas à la priorité. */
type Brush = Priorite | 'efface' | null

/** Occupé (gris) ou vide (blanc). */
const TAKEN: ZoneStyle = { fill: '#c9d2de', fillOpacity: 1, stroke: '#ffffff', strokeWidth: 0.8, pattern: null, slices: null }
const EMPTY: ZoneStyle = { ...TAKEN, fill: '#ffffff', stroke: '#b4c0cf' }
const sameRow = (a: Row, b: Row) => a.priorite === b.priorite && (a.secteur ?? '') === (b.secteur ?? '')
const NONE: Row = { priorite: null, secteur: null }
const isRowMarked = (r: Row) => r.priorite !== null || Boolean(r.secteur)
/** Départements, outre-mer, Monaco et Paris d'un bloc. */
const BASE_ZONES = ZONES.filter((z) => z.type !== 'arrondissement').map((z) => z.code).sort(compareZoneCodes)
/** Pinceau « sans groupe » ; rien de choisi laisse le groupe tel quel. */
const NO_GROUP = ' '

/** Les anciennes fiches « À recruter » : de faux commerciaux, à remplacer par des départements vides. */
function LegacyCard({ data, reload }: AdminDataProps) {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const fiches = data.commerciaux.filter(isARecruter)

  const zones = (c: Commercial) => data.affectations.filter((a) => a.commercial_id === c.id)
  const figures = (c: Commercial) => data.objectifs.filter((o) => o.commercial_id === c.id)
  const withFigures = fiches.filter((c) => figures(c).length)

  const convert = async () => {
    const ok = await confirm({
      title: `Supprimer ${plural(fiches.length, 'fiche')} « À recruter » ?`,
      message: `Leurs départements vides restent à recruter, avec le nom de la fiche pour groupe. ${
        withFigures.length ? `Les CA et objectifs de ${plural(withFigures.length, 'fiche')} sont supprimés avec elles (le journal en garde la trace). ` : ''
      }Cette suppression est définitive.`,
      confirmLabel: 'Supprimer les fiches',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await convertirARecruter(fiches.map((c) => c.id))
      await reload()
      setMessage({ kind: 'success', text: `${plural(res.fiches, 'fiche supprimée', 'fiches supprimées')} ; ${plural(res.zones, 'département')} à recruter dans leur groupe.` })
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  if (!fiches.length) return message ? <div className={`alert ${message.kind}`} style={{ marginBottom: 14 }}>{message.text}</div> : null
  return (
    <div className="card stack" style={{ marginBottom: 18 }}>
      <h2>Anciennes fiches « À recruter » ({fiches.length})</h2>
      <p className="muted" style={{ margin: 0 }}>
        Un poste à pourvoir n'est plus un commercial : un département vide est à recruter. Ces fiches occupent encore leurs départements, qu'aucun
        autre manager ne peut donc prendre. Exportez d'abord si vous voulez garder leur contenu.
      </p>
      <div className="table-wrap">
        <table className="grid list">
          <thead>
            <tr>
              <th>Fiche</th>
              <th>Deviendra le groupe</th>
              <th>Départements</th>
              <th>CA et objectifs, supprimés avec elle</th>
            </tr>
          </thead>
          <tbody>
            {fiches.map((c) => (
              <tr key={c.id}>
                <td>
                  <div className="who-name">{c.nom}</div>
                </td>
                <td>{sectorOf(c) ?? <span className="muted">—</span>}</td>
                <td className="small">{zones(c).map((a) => `${a.structure} ${a.zone_code}`).join(', ') || <span className="muted">aucun</span>}</td>
                <td className="small">
                  {figures(c).length ? (
                    figures(c).map((o) => `${o.structure} ${o.annee} : CA ${formatEuros(o.ca)}, objectif ${formatEuros(o.objectif)}`).join(' · ')
                  ) : (
                    <span className="muted">aucun</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {message && <div className={`alert ${message.kind}`}>{message.text}</div>}
      <div className="row">
        <button type="button" className="btn" onClick={() => void downloadExcel(exportSheets(data, defaultYear(data.objectifs)), `carte-commerciale-avant-${new Date().toISOString().slice(0, 10)}.xlsx`)}>
          <Icon name="download" size={16} />
          Exporter d'abord
        </button>
        <button type="button" className="btn danger" disabled={busy} onClick={() => void convert()}>
          <Icon name="trash" size={16} />
          Supprimer les fiches, garder les groupes
        </button>
      </div>
    </div>
  )
}

interface NameFormProps {
  value: string
  label: string
  onChange: (value: string) => void
  onSubmit: (e: FormEvent) => void
  onCancel: () => void
}

/** Nom d'un groupe, à la création ou au renommage. */
function NameForm({ value, label, onChange, onSubmit, onCancel }: NameFormProps) {
  return (
    <form className="row group-form" onSubmit={onSubmit}>
      <input className="input" autoFocus placeholder="Nom du groupe" aria-label="Nom du groupe" value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onCancel()} />
      <button type="submit" className="btn small primary" disabled={!value.trim()}>
        {label}
      </button>
      <button type="button" className="btn small ghost" onClick={onCancel}>
        Annuler
      </button>
    </form>
  )
}

interface AssignFormProps {
  group: string
  commerciaux: Commercial[]
  structure: Structure
  onSubmit: (id: string) => void
  onCancel: () => void
}

/** Choix du commercial à qui donner les départements d'un groupe. */
function AssignForm({ group, commerciaux, structure, onSubmit, onCancel }: AssignFormProps) {
  const [id, setId] = useState('')
  const options = commerciaux.map((c) => ({ value: c.id, label: c.nom, color: c.couleur, hint: c.structures.includes(structure) ? c.structures.join(' · ') : `pas encore en ${structure}` }))
  return (
    <form
      className="row group-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (id) onSubmit(id)
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <span className="small">
        <strong>{group}</strong> à
      </span>
      <Select className="auto" ariaLabel={`Commercial à qui attribuer ${group}`} value={id} options={options} onChange={setId} placeholder="Choisir un commercial" />
      <button type="submit" className="btn small primary" disabled={!id}>
        Attribuer
      </button>
      <button type="button" className="btn small ghost" onClick={onCancel}>
        Annuler
      </button>
    </form>
  )
}

/** Priorité et groupe des départements d'une structure, vides ou déjà occupés (D-016). */
function Editor({ data, reload, structure }: { data: MapData; reload: () => Promise<void>; structure: Structure }) {
  const [drafts, setDrafts] = useState<Record<string, Row>>({})
  const [brush, setBrush] = useState<Brush>(1)
  const [groupe, setGroupe] = useState('')
  /** Groupes créés, pas encore posés sur un département. */
  const [created, setCreated] = useState<string[]>([])
  const [naming, setNaming] = useState<{ from: string | null; value: string } | null>(null)
  /** Groupe en cours d'attribution à un commercial. */
  const [assigning, setAssigning] = useState<string | null>(null)
  const confirm = useConfirm()
  const [mode, setMode] = useState<'carte' | 'liste'>('carte')
  const [view, setView] = useState<MapViewMode>('france')
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null)
  const [search, setSearch] = useState('')
  const [listAll, setListAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const { geo, error: geoError } = useGeo()

  const occupancy = useMemo(() => occupancyOf(data), [data])
  const taken = occupancy.get(structure)
  /** Quelqu'un y est (pour « 75 » : dans au moins un arrondissement). */
  const occupied = (code: string) => atomsOf(code).some((atom) => Boolean(taken?.get(atom)?.length))
  const saved = useMemo(() => {
    const out: Record<string, Row> = {}
    for (const r of data.a_recruter) if (r.structure === structure) out[r.zone_code] = { priorite: r.priorite, secteur: r.secteur }
    return out
  }, [data.a_recruter, structure])

  // Paris : un seul bloc quand ses arrondissements ont les mêmes commerciaux et pas de ligne à part ; sinon
  // une ligne par arrondissement
  const parisWho = (c: string) => (taken?.get(c) ?? []).map((x) => x.id).sort().join(',')
  const parisSplit = PARIS_ARR_CODES.some((c) => parisWho(c) !== parisWho(PARIS_ARR_CODES[0]) || saved[c] || drafts[c])
  const zones = parisSplit ? [...BASE_ZONES.filter((c) => c !== '75'), ...PARIS_ARR_CODES].sort(compareZoneCodes) : BASE_ZONES
  const open = new Set(zones)
  /** Un arrondissement se peint aussi quand Paris est d'un bloc : Paris se détaille alors. */
  const paintable = (code: string) => open.has(code) || isParisArr(code)
  const rowOf = (code: string): Row => drafts[code] ?? saved[code] ?? (isParisArr(code) ? (drafts['75'] ?? saved['75']) : undefined) ?? NONE
  const dirty = Object.keys(drafts).filter((code) => !sameRow(drafts[code], saved[code] ?? (isParisArr(code) ? (saved['75'] ?? NONE) : NONE)))
  // Chaque groupe et ses départements, brouillons compris
  const groupZones = new Map<string, string[]>(created.map((g) => [g, []]))
  for (const code of zones) {
    const g = rowOf(code).secteur
    if (g) groupZones.set(g, [...(groupZones.get(g) ?? []), code])
  }
  const groupNames = [...groupZones.keys()].sort((a, b) => a.localeCompare(b, 'fr'))
  const groupTop = (g: string) => {
    const p = (groupZones.get(g) ?? []).map((c) => rowOf(c).priorite).filter((x): x is Priorite => x !== null)
    return p.length ? (Math.min(...p) as Priorite) : null
  }

  /** Qui est déjà dans une zone, avec sa couverture. */
  const byId = useMemo(() => new Map(data.commerciaux.map((c) => [c.id, c])), [data.commerciaux])
  const occupantsOf = (code: string) => {
    const atoms = new Set(atomsOf(code))
    const out = new Map<string, string>()
    for (const a of data.affectations) {
      const c = byId.get(a.commercial_id)
      if (a.structure !== structure || !c?.actif || !atomsOf(a.zone_code).some((x) => atoms.has(x))) continue
      out.set(c.nom, COUVERTURE_LABELS[a.couverture].toLowerCase())
    }
    return [...out].map(([nom, couverture]) => `${nom} (${couverture})`).join(', ')
  }

  /** Ce que le pinceau fait d'un département, et ce que son retrait en laisse. */
  const painted = (now: Row): Row => (brush === 'efface' ? NONE : { priorite: brush ?? now.priorite, secteur: groupe === '' ? now.secteur : groupe === NO_GROUP ? null : groupe })
  const unpainted = (now: Row): Row => ({ priorite: brush === null ? now.priorite : null, secteur: groupe === '' ? now.secteur : null })

  // Un trait commence sur un département déjà peint ainsi : il retire, sur tout le trait. Sinon il pose.
  const removing = useRef(false)
  const paint = (code: string, start: boolean) => {
    if (!paintable(code) || (brush === null && groupe === '')) return false
    const now = rowOf(code)
    if (start) {
      setMessage(null)
      removing.current = brush !== 'efface' && sameRow(now, painted(now))
    }
    const next = removing.current ? unpainted(now) : painted(now)
    setDrafts((d) => ({ ...d, [code]: next }))
    return true
  }

  const rename = (from: string, to: string) => {
    setDrafts((d) => ({ ...d, ...Object.fromEntries((groupZones.get(from) ?? []).map((code) => [code, { ...rowOf(code), secteur: to }])) }))
    setCreated((list) => [...new Set(list.map((g) => (g === from ? to : g)))])
    if (groupe === from) setGroupe(to)
  }
  const submitName = (e: FormEvent) => {
    e.preventDefault()
    const name = naming?.value.trim()
    if (!naming || !name) return
    setMessage(null)
    if (naming.from === null) {
      // Le nouveau groupe devient le pinceau : il n'y a plus qu'à peindre
      if (!groupZones.has(name)) setCreated((list) => [...list, name])
      setGroupe(name)
      setBrush(null)
    } else if (name !== naming.from) rename(naming.from, name)
    setNaming(null)
  }
  const removeGroup = async (g: string) => {
    const codes = groupZones.get(g) ?? []
    if (codes.length) {
      const ok = await confirm({
        title: `Supprimer le groupe « ${g} » ?`,
        message: `${plural(codes.length, 'département reste', 'départements restent')} à recruter, sans groupe. Rien n'est enregistré avant « Enregistrer ».`,
        confirmLabel: 'Supprimer le groupe',
        danger: true,
      })
      if (!ok) return
    }
    setMessage(null)
    setDrafts((d) => ({ ...d, ...Object.fromEntries(codes.map((code) => [code, { ...rowOf(code), secteur: null }])) }))
    setCreated((list) => list.filter((x) => x !== g))
    if (groupe === g) setGroupe('')
  }
  const set = (code: string, patch: Partial<Row>) => {
    setMessage(null)
    setDrafts((d) => ({ ...d, [code]: { ...rowOf(code), ...patch } }))
  }

  /** Les départements enregistrés d'un groupe vont à un commercial, en propre ; ceux qu'il a déjà gardent leur couverture. */
  const assign = async (g: string, id: string) => {
    const c = byId.get(id)
    const codes = data.a_recruter.filter((r) => r.structure === structure && r.secteur === g).map((r) => r.zone_code).sort(compareZoneCodes)
    if (!c || !codes.length) return
    const own = data.affectations.filter((a) => a.commercial_id === c.id)
    const before = formatZoneList(own.filter((a) => a.structure === structure))
    const sel = selectionFromText(before)
    const has = (code: string) => (code === '75' ? sel.has('75') || PARIS_ARR_CODES.every((x) => sel.has(x)) : Boolean(coverageIn(sel, code)))
    const added = codes.filter((code) => !has(code))
    const kept = codes.filter(has)
    const ok = await confirm({
      title: `Attribuer le groupe « ${g} » à ${c.nom} ?`,
      message: [
        added.length
          ? `${added.join(', ')} ${added.length > 1 ? "s'ajoutent" : "s'ajoute"} à ses départements ${structure}, en propre : ${added.length > 1 ? 'ils sortent' : 'il sort'} du recrutement.`
          : `${c.nom} a déjà tous ces départements.`,
        kept.length ? `${kept.join(', ')} : ${kept.length > 1 ? 'il les a déjà, ils gardent leur couverture' : "il l'a déjà, il garde sa couverture"}.` : '',
        c.structures.includes(structure) ? '' : `${structure} s'ajoute à ses structures.`,
      ]
        .filter(Boolean)
        .join(' '),
      confirmLabel: 'Attribuer',
    })
    if (!ok) return
    setBusy(true)
    setMessage(null)
    try {
      const after = addZonesToText(before, codes)
      await saveCommercial({
        id: c.id,
        ...(!c.structures.includes(structure) && { structures: [...c.structures, structure] }),
        affectations: [
          ...own.filter((a) => a.structure !== structure).map(({ structure: s, zone_code, couverture }) => ({ structure: s, zone_code, couverture })),
          ...parseZoneList(after).zones.map((z) => ({ structure, zone_code: z.code, couverture: z.couverture })),
        ],
      })
      await reload()
      setAssigning(null)
      setMessage({ kind: 'success', text: `Groupe « ${g} » attribué à ${c.nom}${added.length ? ` : ${added.join(', ')} en propre` : ''}.` })
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const model = useMemo(
    () =>
      ({
        groups: groupNames.map((g): MapGroup => ({ key: g, label: g, color: groupColor(groupTop(g)), codes: groupZones.get(g)! })),
        styleOf: (code: string): ZoneStyle => {
          const codes = code === '75' && !open.has('75') ? PARIS_ARR_CODES : [code]
          const full = codes.some(occupied)
          const priorites = codes.map(rowOf).filter(isRowMarked)
          if (!priorites.length) return full ? TAKEN : EMPTY
          const ps = priorites.map((r) => r.priorite).filter((p): p is Priorite => p !== null)
          // Rayé : à recruter, à la couleur de sa priorité (gris sans) ; par-dessus le gris s'il est occupé
          const color = prioriteColor(ps.length ? (Math.min(...ps) as Priorite) : null)
          if (full) return { ...TAKEN, overlay: recruitOverlay(color) }
          return { ...EMPTY, fill: `url(#${hatchId(color)})`, stroke: '#ffffff', pattern: { id: hatchId(color), kind: 'hatch', color } }
        },
      }) as unknown as MapModel,
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `open`, `occupied` et `rowOf` ne dépendent que de ces valeurs
    [taken, drafts, saved, parisSplit],
  )

  const save = async () => {
    setBusy(true)
    setMessage(null)
    try {
      // Paris détaillé : un « 75 » encore en brouillon vaut pour chaque arrondissement sans le sien
      const codes = parisSplit && dirty.includes('75') ? [...dirty.filter((c) => c !== '75'), ...PARIS_ARR_CODES.filter((c) => !drafts[c])] : dirty
      await setRecrutement(
        structure,
        codes.map((zone_code) => {
          const row = rowOf(zone_code)
          return { zone_code, priorite: row.priorite, secteur: row.secteur?.trim() || null }
        }),
      )
      await reload()
      setDrafts({})
      setCreated([])
      setMessage({ kind: 'success', text: `${plural(dirty.length, 'département enregistré', 'départements enregistrés')}.` })
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const q = search.trim().toLowerCase()
  const listed = zones.filter((c) => {
    if (!listAll && occupied(c) && !isRowMarked(rowOf(c))) return false
    const z = ZONE_BY_CODE.get(c)
    return !q || [c, z?.nom, z?.region, rowOf(c).secteur].join(' ').toLowerCase().includes(q)
  })
  const count = (p: Priorite) => zones.filter((c) => rowOf(c).priorite === p).length
  const empty = zones.filter((c) => !occupied(c)).length
  const reinforced = zones.filter((c) => occupied(c) && isRowMarked(rowOf(c))).length
  const people = data.commerciaux.filter((c) => c.actif && !isARecruter(c)).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))

  const hoverText = (code: string) => {
    if (code === '75' && !open.has('75')) return 'par arrondissement : cliquez pour ouvrir Paris'
    const row = rowOf(code)
    if (isRowMarked(row)) return [prioriteLabel(row.priorite), row.secteur && groupLabel(row.secteur)].filter(Boolean).join(' · ')
    return occupied(code) ? 'pas à recruter' : 'vide, sans priorité'
  }

  return (
    <div className="card stack recruit">
      <div className="row">
        <Sliding className="seg">
          <button type="button" aria-pressed={mode === 'carte'} onClick={() => setMode('carte')}>
            <Icon name="map" size={15} /> Carte
          </button>
          <button type="button" aria-pressed={mode === 'liste'} onClick={() => setMode('liste')}>
            <Icon name="layers" size={15} /> Liste
          </button>
        </Sliding>
        {mode === 'carte' ? (
          <Sliding className="seg">
            {(
              [
                ['france', 'France'],
                ['idf', 'Île-de-France'],
                ['paris', 'Paris'],
              ] as const
            ).map(([v, label]) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
                {label}
              </button>
            ))}
          </Sliding>
        ) : (
          <>
            <Sliding className="seg">
              <button type="button" aria-pressed={!listAll} onClick={() => setListAll(false)}>
                À recruter
              </button>
              <button type="button" aria-pressed={listAll} onClick={() => setListAll(true)}>
                Tous
              </button>
            </Sliding>
            <SearchInput style={{ width: 240 }} value={search} onChange={setSearch} placeholder="Code, département, groupe…" />
          </>
        )}
        <span className="muted small">
          {plural(empty, 'département vide', 'départements vides')}
          {reinforced > 0 && ` · ${plural(reinforced, 'occupé à recruter aussi', 'occupés à recruter aussi')}`} ·{' '}
          {PRIORITES.map((p) => `${count(p.value)} en priorité ${p.value}`).join(', ')}
        </span>
        <span className="grow" />
        {dirty.length > 0 && (
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => {
              setDrafts({})
              setCreated([])
            }}
          >
            Annuler
          </button>
        )}
        <button type="button" className="btn primary" disabled={busy || !dirty.length} onClick={() => void save()}>
          <Icon name={busy ? 'refresh' : 'save'} size={16} className={busy ? 'spin' : undefined} />
          {dirty.length ? `Enregistrer (${dirty.length})` : 'Enregistré'}
        </button>
      </div>

      {message && (
        <div className={`alert ${message.kind}`} role="status">
          <Icon name={message.kind === 'success' ? 'check' : 'alert'} size={16} />
          {message.text}
        </div>
      )}

      <div className="groups">
        <span className="muted small">Groupes</span>
        {groupNames.map((g) =>
          naming?.from === g ? (
            <NameForm key={g} value={naming.value} onChange={(value) => setNaming({ from: g, value })} onSubmit={submitName} onCancel={() => setNaming(null)} label="Renommer" />
          ) : assigning === g ? (
            <AssignForm key={g} group={g} commerciaux={people} structure={structure} onSubmit={(id) => void assign(g, id)} onCancel={() => setAssigning(null)} />
          ) : (
            <span key={g} className={'group-chip' + (groupe === g ? ' on' : '')}>
              <button
                type="button"
                className="group-pick"
                aria-pressed={groupe === g}
                title={groupe === g ? 'Ne plus peindre ce groupe' : 'Peindre ce groupe'}
                onClick={() => {
                  setGroupe(groupe === g ? '' : g)
                  if (groupe !== g) setBrush(null)
                }}
              >
                <HatchSwatch color={prioriteColor(groupTop(g))} />
                {g} <span className="muted">{groupZones.get(g)!.length}</span>
              </button>
              <button
                type="button"
                className="group-tool"
                aria-label={`Attribuer ${g} à un commercial`}
                title={dirty.length ? "Enregistrez d'abord vos modifications" : !groupZones.get(g)!.length ? 'Aucun département dans ce groupe' : 'Attribuer à un commercial'}
                disabled={busy || dirty.length > 0 || !groupZones.get(g)!.length}
                onClick={() => {
                  setNaming(null)
                  setAssigning(g)
                }}
              >
                <Icon name="user" size={13} />
              </button>
              <button type="button" className="group-tool" aria-label={`Renommer ${g}`} title="Renommer" onClick={() => setNaming({ from: g, value: g })}>
                <Icon name="pencil" size={13} />
              </button>
              <button type="button" className="group-tool" aria-label={`Supprimer ${g}`} title="Supprimer" onClick={() => void removeGroup(g)}>
                <Icon name="x" size={14} />
              </button>
            </span>
          ),
        )}
        {groupNames.length > 0 && (
          <span className={'group-chip' + (groupe === NO_GROUP ? ' on' : '')}>
            <button
              type="button"
              className="group-pick"
              aria-pressed={groupe === NO_GROUP}
              onClick={() => {
                setGroupe(groupe === NO_GROUP ? '' : NO_GROUP)
                if (groupe !== NO_GROUP) setBrush(null)
              }}
            >
              Sans groupe
            </button>
          </span>
        )}
        {naming && naming.from === null ? (
          <NameForm value={naming.value} onChange={(value) => setNaming({ from: null, value })} onSubmit={submitName} onCancel={() => setNaming(null)} label="Créer" />
        ) : (
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setAssigning(null)
              setNaming({ from: null, value: '' })
            }}
          >
            <Icon name="plus" size={15} />
            Nouveau groupe
          </button>
        )}
      </div>

      {mode === 'carte' ? (
        <>
          <div className="row">
            <span className="muted small">Pinceau</span>
            <Sliding className="seg">
              {PRIORITES.map((p) => (
                <button key={p.value} type="button" aria-pressed={brush === p.value} onClick={() => setBrush(brush === p.value ? null : p.value)}>
                  <HatchSwatch color={p.color} /> {p.label}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={brush === 'efface'}
                onClick={() => {
                  setBrush(brush === 'efface' ? null : 'efface')
                  setGroupe('')
                }}
              >
                Effacer
              </button>
            </Sliding>
            <span className="muted small">
              {brush === 'efface'
                ? 'Retire la priorité et le groupe.'
                : brush === null && groupe === ''
                  ? 'Choisissez une priorité ou un groupe.'
                  : `Pose : ${[brush && prioriteLabel(brush).toLowerCase(), groupe === NO_GROUP ? 'aucun groupe' : groupe && groupLabel(groupe)].filter(Boolean).join(' et ')}.`}{' '}
              <span className="hide-mobile">Restez appuyé pour en peindre plusieurs ; clic droit ou fond de carte pour déplacer.</span>
              <span className="show-mobile">Appui long puis glissez pour en peindre plusieurs.</span>
            </span>
          </div>
          <div className="map-area recruit-map" onPointerLeave={() => setHover(null)}>
            {geo ? (
              <MapView
                view={view}
                geo={geo}
                model={model}
                highlighted={new Set()}
                selected={null}
                showLabels
                sharedMode="rayures"
                onHover={(code, pos) => setHover(code && pos ? { code, ...pos } : null)}
                onSelect={(code) => {
                  if (code === '75' && !open.has('75')) setView('paris')
                  else paint(code, true)
                }}
                onPaint={paint}
                onBackground={() => undefined}
                onSvg={() => undefined}
              />
            ) : (
              <div className="map-empty">{geoError ?? 'Chargement de la carte…'}</div>
            )}
            {hover && (
              <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 10 }}>
                <div className="t-title">{ZONE_BY_CODE.get(hover.code)?.nom ?? hover.code}</div>
                <div className="t-sub">
                  {hover.code} · {hoverText(hover.code)}
                </div>
                {occupied(hover.code) && <div className="t-meta">Déjà là : {occupantsOf(hover.code)}</div>}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="table-wrap">
          <table className="grid list">
            <thead>
              <tr>
                <th style={{ width: 80 }}>Code</th>
                <th>Département</th>
                <th>Déjà là</th>
                <th>Priorité</th>
                <th style={{ width: 280 }}>Groupe</th>
              </tr>
            </thead>
            <tbody>
              {listed.map((code) => {
                const row = rowOf(code)
                return (
                  <tr key={code} className={dirty.includes(code) ? 'dirty' : undefined}>
                    <td>
                      <strong>{code}</strong>
                    </td>
                    <td>
                      {code === '75' ? 'Paris (tous les arrondissements)' : ZONE_BY_CODE.get(code)?.nom}
                      <div className="muted small">{ZONE_BY_CODE.get(code)?.region}</div>
                    </td>
                    <td className="small">{occupied(code) ? occupantsOf(code) : <span className="muted">personne</span>}</td>
                    <td>
                      <Sliding className="seg">
                        {PRIORITES.map((p) => (
                          <button key={p.value} type="button" aria-pressed={row.priorite === p.value} onClick={() => set(code, { priorite: p.value })} title={p.label} aria-label={`${p.label} pour ${code}`}>
                            <HatchSwatch color={p.color} /> {p.value}
                          </button>
                        ))}
                        <button type="button" aria-pressed={row.priorite === null} onClick={() => set(code, { priorite: null })}>
                          Aucune
                        </button>
                      </Sliding>
                    </td>
                    <td>
                      <Select
                        ariaLabel={`Groupe de ${code}`}
                        value={row.secteur ?? ''}
                        options={groupNames.map((s) => ({ value: s, label: s }))}
                        onChange={(v) => set(code, { secteur: v || null })}
                        emptyLabel="Sans groupe"
                        creatable
                        createLabel={(text) => `Nouveau groupe « ${text} »`}
                      />
                    </td>
                  </tr>
                )
              })}
              {!listed.length && (
                <tr>
                  <td colSpan={5} className="muted">
                    {q ? 'Aucun département ne correspond.' : 'Rien à recruter dans cette structure. « Tous » montre aussi les départements occupés.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function RecrutementPage({ data, reload }: AdminDataProps) {
  const codes = structureCodes(data.structures)
  const [structure, setStructure] = useState<Structure>(codes[0] ?? '')

  return (
    <>
      <header>
        <h1>Recrutement</h1>
        <span className="muted">{structureName(data.structures, structure)}</span>
      </header>
      <LegacyCard data={data} reload={reload} />
      <div className="toolbar-row">
        <Sliding className="seg wrap">
          {codes.map((s) => (
            <button key={s} type="button" aria-pressed={structure === s} onClick={() => setStructure(s)}>
              {s}
            </button>
          ))}
        </Sliding>
        <span className="muted small">
          Un département vide est à recruter. La priorité (1 à 3) le raye de sa couleur, de gris sans priorité ; un groupe réunit les
          départements d'un même poste. Un département occupé peut l'être aussi : pour un second commercial, ou un commercial en propre là où il
          n'y a que de la gestion ou du partiel. Il sort du recrutement dès qu'un commercial y arrive en propre.
        </span>
      </div>
      {structure && <Editor key={structure} data={data} reload={reload} structure={structure} />}
    </>
  )
}

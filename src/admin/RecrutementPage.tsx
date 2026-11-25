import { useMemo, useRef, useState, type FormEvent } from 'react'
import Icon from '../components/Icon'
import { HatchSwatch } from '../components/Legend'
import MapView, { type MapViewMode } from '../components/MapView'
import SearchInput from '../components/SearchInput'
import Sliding from '../components/Sliding'
import Select from '../components/Select'
import { useConfirm } from '../hooks/useConfirm'
import { useGeo } from '../hooks/useGeo'
import { convertirARecruter, setRecrutement } from '../lib/api'
import { downloadExcel } from '../lib/excelSheets'
import { exportSheets } from '../lib/exportExcel'
import { groupColor, hatchId, type MapGroup, type MapModel, type ZoneStyle } from '../lib/mapModel'
import { defaultYear } from '../lib/performance'
import { PRIORITES, groupLabel, isARecruter, occupancyOf, prioriteColor, prioriteLabel, sectorOf, vacantZones } from '../lib/recrutement'
import { structureCodes, structureName } from '../lib/structures'
import { plural } from '../lib/text'
import type { Commercial, MapData, Priorite, Structure } from '../lib/types'
import { PARIS_ARR_CODES, ZONE_BY_CODE, isParisArr } from '../lib/zones'
import { formatEuros } from '../lib/zoneDetails'
import type { AdminDataProps } from './AdminApp'

/** `secteur` : le groupe du département (les départements d'un même poste). */
type Row = { priorite: Priorite | null; secteur: string | null }
/** null : le pinceau ne touche pas à la priorité. */
type Brush = Priorite | 'efface' | null

const TAKEN: ZoneStyle = { fill: '#c9d2de', fillOpacity: 1, stroke: '#ffffff', strokeWidth: 0.8, pattern: null, slices: null }
const EMPTY: ZoneStyle = { ...TAKEN, fill: '#ffffff', stroke: '#b4c0cf' }
const sameRow = (a: Row, b: Row) => a.priorite === b.priorite && (a.secteur ?? '') === (b.secteur ?? '')
const NONE: Row = { priorite: null, secteur: null }
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

/** Priorité et groupe des départements vides, structure par structure. */
function Editor({ data, reload, structure }: { data: MapData; reload: () => Promise<void>; structure: Structure }) {
  const [drafts, setDrafts] = useState<Record<string, Row>>({})
  const [brush, setBrush] = useState<Brush>(1)
  const [groupe, setGroupe] = useState('')
  /** Groupes créés, pas encore posés sur un département. */
  const [created, setCreated] = useState<string[]>([])
  const [naming, setNaming] = useState<{ from: string | null; value: string } | null>(null)
  const confirm = useConfirm()
  const [mode, setMode] = useState<'carte' | 'liste'>('carte')
  const [view, setView] = useState<MapViewMode>('france')
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const { geo, error: geoError } = useGeo()

  const occupancy = useMemo(() => occupancyOf(data), [data])
  const vacant = useMemo(() => vacantZones(structure, occupancy), [structure, occupancy])
  const free = useMemo(() => new Set(vacant), [vacant])
  const saved = useMemo(() => {
    const out: Record<string, Row> = {}
    for (const r of data.a_recruter) if (r.structure === structure) out[r.zone_code] = { priorite: r.priorite, secteur: r.secteur }
    return out
  }, [data.a_recruter, structure])

  // Paris : une ligne pour « 75 », ou une par arrondissement dès que l'un d'eux diffère ou est pourvu
  const parisSplit = !free.has('75') || PARIS_ARR_CODES.some((c) => saved[c] || drafts[c])
  const zones = parisSplit && free.has('75') ? vacant.flatMap((c) => (c === '75' ? PARIS_ARR_CODES : [c])) : vacant
  const open = new Set(zones)
  const rowOf = (code: string): Row => drafts[code] ?? saved[code] ?? (isParisArr(code) && free.has('75') ? saved['75'] : undefined) ?? NONE
  const dirty = Object.keys(drafts).filter((code) => !sameRow(drafts[code], saved[code] ?? (isParisArr(code) ? (saved['75'] ?? NONE) : NONE)))
  // Chaque groupe et ses départements vides, brouillons compris
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

  /** Ce que le pinceau fait d'un département, et ce que son retrait en laisse. */
  const painted = (now: Row): Row => (brush === 'efface' ? NONE : { priorite: brush ?? now.priorite, secteur: groupe === '' ? now.secteur : groupe === NO_GROUP ? null : groupe })
  const unpainted = (now: Row): Row => ({ priorite: brush === null ? now.priorite : null, secteur: groupe === '' ? now.secteur : null })

  // Un trait commence sur un département déjà peint ainsi : il retire, sur tout le trait. Sinon il pose.
  const removing = useRef(false)
  const paint = (code: string, start: boolean) => {
    if (!open.has(code) || (brush === null && groupe === '')) return false
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

  const model = useMemo(
    () =>
      ({
        groups: groupNames.map((g): MapGroup => ({ key: g, label: g, color: groupColor(groupTop(g)), codes: groupZones.get(g)! })),
        styleOf: (code: string): ZoneStyle => {
          const codes = code === '75' && !open.has('75') ? PARIS_ARR_CODES.filter((c) => open.has(c)) : [code]
          if (!codes.length || !codes.some((c) => open.has(c))) return TAKEN
          const rows = codes.map(rowOf)
          const priorites = rows.map((r) => r.priorite).filter((p): p is Priorite => p !== null)
          // Rayé : une priorité. Le groupe, lui, est entouré.
          if (!priorites.length) return EMPTY
          const color = prioriteColor(Math.min(...priorites) as Priorite)
          return { ...EMPTY, fill: `url(#${hatchId(color)})`, stroke: '#ffffff', pattern: { id: hatchId(color), kind: 'hatch', color } }
        },
      }) as unknown as MapModel,
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `open` et `rowOf` ne dépendent que de ces valeurs
    [vacant, drafts, saved, parisSplit],
  )

  const save = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await setRecrutement(
        structure,
        dirty.map((zone_code) => ({ zone_code, priorite: drafts[zone_code].priorite, secteur: drafts[zone_code].secteur?.trim() || null })),
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
    const z = ZONE_BY_CODE.get(c)
    return !q || [c, z?.nom, z?.region, rowOf(c).secteur].join(' ').toLowerCase().includes(q)
  })
  const count = (p: Priorite) => zones.filter((c) => rowOf(c).priorite === p).length

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
          <SearchInput style={{ width: 240 }} value={search} onChange={setSearch} placeholder="Code, département, groupe…" />
        )}
        <span className="muted small">
          {plural(zones.length, 'département vide', 'départements vides')} · {PRIORITES.map((p) => `${count(p.value)} en priorité ${p.value}`).join(', ')}
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
          <button type="button" className="btn small" onClick={() => setNaming({ from: null, value: '' })}>
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
                  {hover.code} ·{' '}
                  {open.has(hover.code)
                    ? [prioriteLabel(rowOf(hover.code).priorite), rowOf(hover.code).secteur && groupLabel(rowOf(hover.code).secteur!)].filter(Boolean).join(' · ')
                    : hover.code === '75' && zones.some(isParisArr)
                      ? 'par arrondissement : cliquez pour ouvrir Paris'
                      : `occupé par ${[...new Set((occupancy.get(structure)?.get(hover.code) ?? (hover.code === '75' ? PARIS_ARR_CODES.flatMap((c) => occupancy.get(structure)?.get(c) ?? []) : [])).map((c) => c.nom))].join(', ')}`}
                </div>
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
                  <td colSpan={4} className="muted">
                    {zones.length ? 'Aucun département ne correspond.' : 'Aucun département vide dans cette structure.'}
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
          Un département vide est à recruter. La priorité (1 à 3) le colore sur la carte ; un groupe réunit les départements d'un même poste. Un
          département pourvu en sort tout seul.
        </span>
      </div>
      {structure && <Editor key={structure} data={data} reload={reload} structure={structure} />}
    </>
  )
}

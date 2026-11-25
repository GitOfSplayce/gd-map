import { useMemo, useState } from 'react'
import Icon from '../components/Icon'
import { HatchSwatch } from '../components/Legend'
import MapView, { type MapViewMode } from '../components/MapView'
import SearchInput from '../components/SearchInput'
import Select from '../components/Select'
import { useConfirm } from '../hooks/useConfirm'
import { useGeo } from '../hooks/useGeo'
import { convertirARecruter, setRecrutement } from '../lib/api'
import { downloadExcel } from '../lib/excelSheets'
import { exportSheets } from '../lib/exportExcel'
import { hatchId, type MapModel, type ZoneStyle } from '../lib/mapModel'
import { defaultYear } from '../lib/performance'
import { PRIORITES, isARecruter, occupancyOf, prioriteColor, prioriteLabel, sectorLabel, sectorOf, vacantZones } from '../lib/recrutement'
import { structureCodes, structureName } from '../lib/structures'
import { plural } from '../lib/text'
import type { Commercial, MapData, Priorite, Structure } from '../lib/types'
import { PARIS_ARR_CODES, ZONE_BY_CODE, isParisArr } from '../lib/zones'
import { formatEuros } from '../lib/zoneDetails'
import type { AdminDataProps } from './AdminApp'

type Row = { priorite: Priorite | null; secteur: string | null }
type Brush = Priorite | 'none'

const TAKEN: ZoneStyle = { fill: '#c9d2de', fillOpacity: 1, stroke: '#ffffff', strokeWidth: 0.8, pattern: null, slices: null }
const EMPTY: ZoneStyle = { ...TAKEN, fill: '#ffffff', stroke: '#b4c0cf' }
const sameRow = (a: Row, b: Row) => a.priorite === b.priorite && (a.secteur ?? '') === (b.secteur ?? '')
const NONE: Row = { priorite: null, secteur: null }
/** Choix « Sans secteur » du pinceau ; rien de choisi laisse le secteur tel quel. */
const NO_SECTOR = ' '

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
      message: `Leurs départements vides restent à recruter, avec le nom de la fiche pour secteur. ${
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
      setMessage({ kind: 'success', text: `${plural(res.fiches, 'fiche supprimée', 'fiches supprimées')} ; ${plural(res.zones, 'département')} à recruter dans leur secteur.` })
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
              <th>Deviendra le secteur</th>
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
          Supprimer les fiches, garder les secteurs
        </button>
      </div>
    </div>
  )
}

/** Priorité et secteur des départements vides, structure par structure. */
function Editor({ data, reload, structure }: { data: MapData; reload: () => Promise<void>; structure: Structure }) {
  const [drafts, setDrafts] = useState<Record<string, Row>>({})
  const [brush, setBrush] = useState<Brush>(1)
  const [secteur, setSecteur] = useState('')
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
  const secteurs = [...new Set([...Object.values(saved), ...Object.values(drafts)].map((r) => r.secteur).filter((s): s is string => Boolean(s)))].sort((a, b) => a.localeCompare(b, 'fr'))

  const paint = (code: string) => {
    if (!open.has(code)) return
    setMessage(null)
    const now = rowOf(code)
    const sector = secteur === '' ? now.secteur : secteur === NO_SECTOR ? null : secteur
    const next: Row = brush === 'none' ? NONE : { priorite: brush, secteur: sector }
    // Un nouveau clic avec le même pinceau retire ce qu'il pose, et rien d'autre
    setDrafts((d) => ({ ...d, [code]: sameRow(now, next) ? { priorite: null, secteur: secteur === '' ? now.secteur : null } : next }))
  }
  const set = (code: string, patch: Partial<Row>) => {
    setMessage(null)
    setDrafts((d) => ({ ...d, [code]: { ...rowOf(code), ...patch } }))
  }

  const model = useMemo(
    () =>
      ({
        styleOf: (code: string): ZoneStyle => {
          const codes = code === '75' && !open.has('75') ? PARIS_ARR_CODES.filter((c) => open.has(c)) : [code]
          if (!codes.length || !codes.some((c) => open.has(c))) return TAKEN
          const rows = codes.map(rowOf)
          const priorites = rows.map((r) => r.priorite).filter((p): p is Priorite => p !== null)
          if (!priorites.length && !rows.some((r) => r.secteur)) return EMPTY
          const color = prioriteColor(priorites.length ? (Math.min(...priorites) as Priorite) : null)
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
        <div className="seg">
          <button type="button" aria-pressed={mode === 'carte'} onClick={() => setMode('carte')}>
            <Icon name="map" size={15} /> Carte
          </button>
          <button type="button" aria-pressed={mode === 'liste'} onClick={() => setMode('liste')}>
            <Icon name="layers" size={15} /> Liste
          </button>
        </div>
        {mode === 'carte' ? (
          <div className="seg">
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
          </div>
        ) : (
          <SearchInput style={{ width: 240 }} value={search} onChange={setSearch} placeholder="Code, département, secteur…" />
        )}
        <span className="muted small">
          {plural(zones.length, 'département vide', 'départements vides')} · {PRIORITES.map((p) => `${count(p.value)} en priorité ${p.value}`).join(', ')}
        </span>
        <span className="grow" />
        {dirty.length > 0 && (
          <button type="button" className="btn ghost" disabled={busy} onClick={() => setDrafts({})}>
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

      {mode === 'carte' ? (
        <>
          <div className="row">
            <span className="muted small">Cliquer pose</span>
            <div className="seg">
              {PRIORITES.map((p) => (
                <button key={p.value} type="button" aria-pressed={brush === p.value} onClick={() => setBrush(p.value)}>
                  <HatchSwatch color={p.color} /> {p.label}
                </button>
              ))}
              <button type="button" aria-pressed={brush === 'none'} onClick={() => setBrush('none')}>
                Effacer
              </button>
            </div>
            {brush !== 'none' && (
              <Select
                className="auto"
                ariaLabel="Secteur"
                value={secteur}
                options={[{ value: NO_SECTOR, label: 'Sans secteur' }, ...secteurs.map((s) => ({ value: s, label: s }))]}
                onChange={setSecteur}
                emptyLabel="Secteur inchangé"
                creatable
                createLabel={(t) => `Nouveau secteur « ${t} »`}
              />
            )}
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
                onSelect={(code) => (code === '75' && !open.has('75') ? setView('paris') : paint(code))}
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
                    ? [prioriteLabel(rowOf(hover.code).priorite), rowOf(hover.code).secteur && sectorLabel(rowOf(hover.code).secteur!)].filter(Boolean).join(' · ')
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
                <th style={{ width: 280 }}>Secteur</th>
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
                      <div className="seg">
                        {PRIORITES.map((p) => (
                          <button key={p.value} type="button" aria-pressed={row.priorite === p.value} onClick={() => set(code, { priorite: p.value })} title={p.label} aria-label={`${p.label} pour ${code}`}>
                            <HatchSwatch color={p.color} /> {p.value}
                          </button>
                        ))}
                        <button type="button" aria-pressed={row.priorite === null} onClick={() => set(code, { priorite: null })}>
                          Aucune
                        </button>
                      </div>
                    </td>
                    <td>
                      <Select
                        ariaLabel={`Secteur de ${code}`}
                        value={row.secteur ?? ''}
                        options={secteurs.map((s) => ({ value: s, label: s }))}
                        onChange={(v) => set(code, { secteur: v || null })}
                        emptyLabel="Sans secteur"
                        creatable
                        createLabel={(t) => `Nouveau secteur « ${t} »`}
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
        <div className="seg wrap">
          {codes.map((s) => (
            <button key={s} type="button" aria-pressed={structure === s} onClick={() => setStructure(s)}>
              {s}
            </button>
          ))}
        </div>
        <span className="muted small">
          Un département vide est à recruter. La priorité (1 à 3) le colore sur la carte ; un secteur réunit les départements d'un même poste. Un
          département pourvu en sort tout seul.
        </span>
      </div>
      {structure && <Editor key={structure} data={data} reload={reload} structure={structure} />}
    </>
  )
}

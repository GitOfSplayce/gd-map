import { useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import { KeySwatch } from '../components/Legend'
import SearchInput from '../components/SearchInput'
import MapView, { type MapViewMode } from '../components/MapView'
import { useGeo } from '../hooks/useGeo'
import { BRAND } from '../lib/colors'
import { NEUTRAL_SLICE, dotsId, sliceOf, stripesId, type MapModel, type ZoneStyle } from '../lib/mapModel'
import { plural } from '../lib/text'
import { COUVERTURE_LABELS, COUVERTURES, type Couverture } from '../lib/types'
import { coverageIn, selectionFromText, selectionToText, toggleGroup, toggleZone, type ZoneSelection } from '../lib/zoneEditing'
import { DROM_CODES, PARIS_ARR_CODES, ZONES, ZONE_BY_CODE, isParisArr } from '../lib/zones'

interface Props {
  title: string
  value: string
  onApply: (text: string) => void
  onClose: () => void
  /** Zones qu'on ne peut pas ajouter, avec qui y est (manager). */
  blocked?: ReadonlyMap<string, string>
}

const EMPTY = '#e4ebf2'
const TAKEN = '#b9c3d0'

/** Même rendu que sur la carte : partiel et gestion-partiel rayés avec du blanc, gestion en points. */
function styleFor(c: Couverture | undefined, partial = false): ZoneStyle {
  const base = { stroke: '#ffffff', strokeWidth: 0.8, slices: null }
  if (c === 'propre') return { ...base, fill: BRAND.saphir, fillOpacity: 0.88, pattern: null }
  if (c === 'partiel' || c === 'gestion_partiel') {
    const stripes = [sliceOf(BRAND.saphir, c), NEUTRAL_SLICE]
    const id = stripesId(stripes)
    return { ...base, fill: `url(#${id})`, fillOpacity: 1, pattern: { id, kind: 'stripes', stripes } }
  }
  if (c === 'gestion') return { ...base, fill: `url(#${dotsId(BRAND.saphir)})`, fillOpacity: 1, pattern: { id: dotsId(BRAND.saphir), kind: 'dots', color: BRAND.saphir } }
  if (partial) return { ...base, fill: BRAND.saphir, fillOpacity: 0.2, pattern: null }
  return { ...base, fill: EMPTY, fillOpacity: 1, pattern: null }
}

// Groupes de la vue liste : régions de métropole, puis Paris, outre-mer et Monaco
const GROUPS: { name: string; codes: string[] }[] = (() => {
  const metro = ZONES.filter((z) => z.type === 'departement')
  const regions = [...new Set(metro.map((z) => z.region))].sort((a, b) => a.localeCompare(b, 'fr'))
  return [
    ...regions.map((r) => ({ name: r, codes: metro.filter((z) => z.region === r).map((z) => z.code) })),
    { name: 'Paris par arrondissement', codes: PARIS_ARR_CODES },
    { name: 'Outre-mer', codes: DROM_CODES },
    { name: 'Monaco', codes: ['98'] },
  ]
})()

const tileLabel = (code: string) => (isParisArr(code) ? `${code.slice(3)}${code === '75-1' ? 'er' : 'e'}` : code)
const tileName = (code: string) => {
  const nom = ZONE_BY_CODE.get(code)?.nom ?? code
  return isParisArr(code) ? nom.replace(/^Paris \d+(er|e) – /, '') : nom
}

/** Assistant de saisie des zones : carte ou liste cliquable, en plus de la saisie en texte. */
export default function ZoneAssistant({ title, value, onApply, onClose, blocked }: Props) {
  const [sel, setSel] = useState<ZoneSelection>(() => selectionFromText(value))
  const [brush, setBrush] = useState<Couverture>('propre')
  const [mode, setMode] = useState<'carte' | 'liste'>('carte')
  const [view, setView] = useState<MapViewMode>('france')
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null)
  const [search, setSearch] = useState('')
  const { geo, error } = useGeo()

  const text = selectionToText(sel)
  const count = new Set([...sel.keys()].filter((c) => !isParisArr(c) || !sel.has('75'))).size

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // La carte n'a besoin que du style de chaque zone
  const model = useMemo(
    () =>
      ({
        styleOf: (code: string) => {
          if (code === '75') {
            const own = sel.get('75')
            const partial = PARIS_ARR_CODES.some((c) => sel.has(c))
            return !own && !partial && blocked?.has('75') ? { ...styleFor(undefined), fill: TAKEN } : styleFor(own, partial)
          }
          const c = coverageIn(sel, code)
          return !c && blocked?.has(code) ? { ...styleFor(undefined), fill: TAKEN } : styleFor(c)
        },
      }) as unknown as MapModel,
    [sel, blocked],
  )

  // Une zone prise par un autre manager ne s'ajoute pas ; tout Paris non plus si un arrondissement l'est
  const locked = (s: ZoneSelection, code: string) => Boolean(blocked?.has(code)) && !coverageIn(s, code)
  const toggle = (code: string) => setSel((s) => (locked(s, code) ? s : toggleZone(s, code, brush)))
  const toggleAll = (codes: string[]) => setSel((s) => toggleGroup(s, codes.filter((c) => !locked(s, c)), brush))

  const q = search.trim().toLowerCase()
  const groups = GROUPS.map((g) => ({
    ...g,
    codes: q ? g.codes.filter((c) => c.toLowerCase().includes(q) || tileName(c).toLowerCase().includes(q) || g.name.toLowerCase().includes(q)) : g.codes,
  })).filter((g) => g.codes.length)

  return (
    <div className="modal-backdrop">
      <div className="assistant" role="dialog" aria-modal="true" aria-label={title}>
        <header className="assistant-head">
          <div className="grow">
            <h2>{title}</h2>
            <p className="muted small">
              Cliquez sur les zones : ajout avec la couverture choisie, nouveau clic pour retirer ou changer de couverture.
              {blocked && blocked.size > 0 && ' En gris foncé : occupé par le commercial d\'un autre manager.'}
            </p>
          </div>
          <button type="button" className="btn small ghost icon" onClick={onClose} aria-label="Fermer" title="Fermer">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="assistant-tools">
          <div className="group">
            <span className="label">Couverture</span>
            <div className="seg brush">
              {COUVERTURES.map((c) => (
                <button key={c} type="button" aria-pressed={brush === c} onClick={() => setBrush(c)}>
                  <KeySwatch kind={c} />
                  {COUVERTURE_LABELS[c]}
                </button>
              ))}
            </div>
          </div>
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
            <SearchInput style={{ width: 240 }} value={search} onChange={setSearch} placeholder="Code, département ou région…" />
          )}
        </div>

        <div className="assistant-body">
          {mode === 'carte' ? (
            <div className="map-area assistant-map" onPointerLeave={() => setHover(null)}>
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
                  onSelect={toggle}
                  onBackground={() => undefined}
                  onSvg={() => undefined}
                />
              ) : (
                <div className="map-empty">{error ?? 'Chargement de la carte…'}</div>
              )}
              {hover && (
                <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 10 }}>
                  <div className="t-title">{ZONE_BY_CODE.get(hover.code)?.nom ?? hover.code}</div>
                  <div className="t-sub">
                    {hover.code} ·{' '}
                    {coverageIn(sel, hover.code)
                      ? COUVERTURE_LABELS[coverageIn(sel, hover.code)!]
                      : locked(sel, hover.code)
                        ? `occupé par ${blocked!.get(hover.code)}`
                        : 'non sélectionnée'}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="assistant-list">
              {groups.map((g) => {
                const allBrush = g.codes.every((c) => coverageIn(sel, c) === brush)
                return (
                  <section key={g.name}>
                    <div className="al-head">
                      <h3>{g.name}</h3>
                      {g.codes.length > 1 && (
                        <button type="button" className="btn small ghost" onClick={() => toggleAll(g.codes)}>
                          {allBrush ? 'Tout retirer' : `Tout en ${COUVERTURE_LABELS[brush].toLowerCase()}`}
                        </button>
                      )}
                    </div>
                    <div className="al-tiles">
                      {g.name === 'Paris par arrondissement' && (
                        <button type="button" className={'zone-tile wide ' + (sel.get('75') ?? '')} onClick={() => toggle('75')} disabled={locked(sel, '75')}>
                          <b>75</b>
                          <span>Tout Paris</span>
                        </button>
                      )}
                      {g.codes.map((code) => (
                        <button
                          key={code}
                          type="button"
                          className={'zone-tile ' + (coverageIn(sel, code) ?? '')}
                          onClick={() => toggle(code)}
                          disabled={locked(sel, code)}
                          title={locked(sel, code) ? `${ZONE_BY_CODE.get(code)?.nom} : occupé par ${blocked!.get(code)}` : ZONE_BY_CODE.get(code)?.nom}
                        >
                          <b>{tileLabel(code)}</b>
                          <span>{tileName(code)}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )
              })}
              {!groups.length && <p className="muted">Aucune zone ne correspond.</p>}
            </div>
          )}
        </div>

        <footer className="assistant-foot">
          <div className="assistant-preview">
            <span className="muted small">{plural(count, 'zone')} · texte écrit dans le champ :</span>
            <code>{text || '—'}</code>
          </div>
          <div className="row">
            <button type="button" className="btn ghost" onClick={() => setSel(new Map())} disabled={!sel.size}>
              Tout effacer
            </button>
            <span className="grow" />
            <button type="button" className="btn ghost" onClick={onClose}>
              Annuler
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                onApply(text)
                onClose()
              }}
            >
              <Icon name="check" size={16} />
              Appliquer
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

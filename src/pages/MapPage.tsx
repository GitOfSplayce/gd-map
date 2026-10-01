import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import FiltersPanel from '../components/FiltersPanel'
import Icon from '../components/Icon'
import Legend from '../components/Legend'
import MapView, { type MapViewMode } from '../components/MapView'
import ZonePanel from '../components/ZonePanel'
import Switch from '../components/Switch'
import ZoneTooltip from '../components/ZoneTooltip'
import { useAdminSession } from '../hooks/useAdminSession'
import { useGeo } from '../hooks/useGeo'
import { useMapAccess } from '../hooks/useMapAccess'
import { exportMapPng } from '../lib/exportPng'
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  buildMapModel,
  type ColorMode,
  type Filters,
  type SharedMode,
  type Tab,
} from '../lib/mapModel'
import { plural } from '../lib/text'
import { STRUCTURE_LABELS, STRUCTURES, type MapData } from '../lib/types'
import CodeGate from './CodeGate'

const TABS: { key: Tab; label: string; sub: string }[] = [
  { key: 'ALL', label: 'Globale', sub: 'Toutes structures' },
  ...STRUCTURES.map((s) => ({ key: s as Tab, label: s, sub: STRUCTURE_LABELS[s] })),
]
const VIEWS: { key: MapViewMode; label: string }[] = [
  { key: 'france', label: 'France' },
  { key: 'idf', label: 'Île-de-France' },
  { key: 'paris', label: 'Paris' },
]
const COLOR_MODES: { key: ColorMode; label: string }[] = [
  { key: 'commercial', label: 'Commercial' },
  { key: 'manager1', label: 'Manager 1' },
  { key: 'manager2', label: 'Manager 2' },
  { key: 'couverture', label: 'Couverture' },
]
const SHARED_MODES: SharedMode[] = ['rayures', 'camemberts']

export default function MapPage() {
  const admin = useAdminSession()
  const access = useMapAccess(admin)

  if (access.data && access.status !== 'locked') {
    return <MapScreen data={access.data} isAdmin={admin.isAdmin} onLock={access.lock} onReload={access.reload} />
  }
  if (access.status === 'checking' || (access.status === 'loading' && admin.isAdmin)) {
    return <div className="map-empty">Chargement…</div>
  }
  return <CodeGate error={access.error} busy={access.status === 'loading'} onSubmit={access.submit} />
}

interface ScreenProps {
  data: MapData
  isAdmin: boolean
  onLock: () => void
  onReload: () => Promise<unknown>
}

function MapScreen({ data, isAdmin, onLock, onReload }: ScreenProps) {
  const [params, setParams] = useSearchParams()
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const v = params.get(key) as T | null
    return v && allowed.includes(v) ? v : fallback
  }
  const tab = pick<Tab>('onglet', TABS.map((t) => t.key), 'ALL')
  const view = pick<MapViewMode>('vue', VIEWS.map((v) => v.key), 'france')
  const colorMode = pick<ColorMode>('couleur', COLOR_MODES.map((c) => c.key), 'commercial')
  const showLabels = params.get('codes') !== '0'
  const sharedMode = pick<SharedMode>('partage', SHARED_MODES, 'rayures')

  const setParam = (key: string, value: string, fallback: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (value === fallback) next.delete(key)
        else next.set(key, value)
        return next
      },
      { replace: true },
    )

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [hover, setHover] = useState<{ code: string; x: number; y: number; w: number; h: number } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [reloading, setReloading] = useState(false)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const { geo, error: geoError } = useGeo()

  const model = useMemo(() => buildMapModel(data, tab, filters, colorMode), [data, tab, filters, colorMode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setShowFilters(false)
      setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggleHighlight = (key: string) =>
    setHighlighted((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const setColorMode = (m: ColorMode) => {
    setHighlighted(new Set())
    setParam('couleur', m, 'commercial')
  }

  const filterCount = activeFilterCount(filters)
  const tabInfo = TABS.find((t) => t.key === tab)!
  const updated = data.updated_at ? new Date(data.updated_at).toLocaleDateString('fr-FR') : null

  const reload = async () => {
    setReloading(true)
    try {
      await onReload()
    } finally {
      setReloading(false)
    }
  }

  const exportPng = async () => {
    if (!svgRef.current) return
    setExporting(true)
    try {
      const legend = model.legend.filter((l) => !highlighted.size || highlighted.has(l.key))
      const parts = [
        VIEWS.find((v) => v.key === view)!.label,
        `couleur : ${COLOR_MODES.find((c) => c.key === colorMode)!.label}`,
        filterCount ? `${plural(filterCount, 'filtre actif', 'filtres actifs')}` : null,
        `export du ${new Date().toLocaleDateString('fr-FR')}`,
      ]
      await exportMapPng(svgRef.current, {
        title: `Carte commerciale – ${tab === 'ALL' ? 'Vue globale' : `${tab} (${tabInfo.sub})`}`,
        subtitle: parts.filter(Boolean).join(' · '),
        legend,
        filename: `carte-${tab.toLowerCase()}-${view}-${new Date().toISOString().slice(0, 10)}.png`,
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="app-shell">
      <AppHeader
        nav={
          <nav className="tabs" role="tablist" aria-label="Structure">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => {
                  setParam('onglet', t.key, 'ALL')
                  setSelected(null)
                }}
                title={t.sub}
              >
                {t.label}
                <span className="tab-sub hide-mobile">{t.sub}</span>
              </button>
            ))}
          </nav>
        }
        actions={
          <>
            <Link className="btn small ghost" to="/aide">
              <Icon name="help" size={16} />
              <span className="hide-mobile">Aide</span>
            </Link>
            {isAdmin ? (
              <Link className="btn small" to="/admin">
                <Icon name="settings" size={16} />
                Admin
              </Link>
            ) : (
              <button type="button" className="btn small" onClick={onLock} title="Oublier le code sur cet appareil">
                <Icon name="logout" size={16} />
                Quitter
              </button>
            )}
          </>
        }
      />

      <div className="toolbar">
        <div className="group">
          <span className="label">Vue</span>
          <div className="seg">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                aria-pressed={view === v.key}
                onClick={() => {
                  setParam('vue', v.key, 'france')
                  setHover(null)
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <div className="group">
          <span className="label">Couleur</span>
          <div className="seg">
            {COLOR_MODES.map((c) => (
              <button key={c.key} type="button" aria-pressed={colorMode === c.key} onClick={() => setColorMode(c.key)}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div className="group">
          <button type="button" className="btn small" aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)}>
            <Icon name="filter" size={16} />
            Filtres
            {filterCount > 0 && <span className="count-dot">{filterCount}</span>}
          </button>
          <button type="button" className="btn small" onClick={exportPng} disabled={exporting || !geo}>
            <Icon name="image" size={16} className={exporting ? 'spin' : undefined} />
            {exporting ? 'Export…' : 'Export PNG'}
          </button>
          <Switch checked={showLabels} onChange={(on) => setParam('codes', on ? '1' : '0', '1')} label="Codes" />
        </div>
        <div className="updated hide-mobile">
          {updated && <span>Données du {updated}</span>}
          <button
            type="button"
            className="btn small ghost icon"
            onClick={reload}
            disabled={reloading}
            title="Recharger les données"
            aria-label="Recharger les données"
          >
            <Icon name="refresh" size={16} className={reloading ? 'spin' : undefined} />
          </button>
        </div>
      </div>

      <div className="map-layout">
        <section className="map-area" onPointerLeave={() => setHover(null)}>
          {geo ? (
            <MapView
              view={view}
              geo={geo}
              model={model}
              highlighted={highlighted}
              selected={selected}
              showLabels={showLabels}
              onHover={(code, pos) => setHover(code && pos ? { code, ...pos } : null)}
              onSelect={(code) => {
                setSelected(code)
                setShowFilters(false)
              }}
              sharedMode={sharedMode}
              onBackground={() => {
                setSelected(null)
                setHighlighted(new Set())
                setShowFilters(false)
              }}
              onSvg={(el) => {
                svgRef.current = el
              }}
            />
          ) : (
            <div className="map-empty">{geoError ?? 'Chargement de la carte…'}</div>
          )}

          {hover && (
            <ZoneTooltip
              code={hover.code}
              x={hover.x}
              y={hover.y}
              model={model}
              containerWidth={hover.w}
              containerHeight={hover.h}
            />
          )}

          {showFilters && (
            <FiltersPanel
              filters={filters}
              onChange={setFilters}
              model={model}
              commerciaux={data.commerciaux.filter((c) => tab === 'ALL' || c.structures.includes(tab))}
              onClose={() => setShowFilters(false)}
            />
          )}

          {!showFilters && <div className="map-hint hide-mobile">Molette ou boutons pour zoomer · clic sur une zone pour le détail</div>}
        </section>

        <aside className="sidebar">
          {selected ? (
            <>
              <div className="sidebar-head">
                <h2 className="grow">Détail de la zone</h2>
                <button type="button" className="btn small ghost icon" onClick={() => setSelected(null)} aria-label="Fermer le détail" title="Fermer">
                  <Icon name="x" size={18} />
                </button>
              </div>
              <div className="sidebar-body">
                <ZonePanel
                  code={selected}
                  model={model}
                  view={view}
                  highlighted={highlighted}
                  onToggleHighlight={toggleHighlight}
                  onChangeView={(v) => setParam('vue', v, 'france')}
                />
              </div>
            </>
          ) : (
            <>
              <div className="sidebar-head">
                <h2 className="grow">{colorMode === 'couverture' ? 'Couverture' : 'Légende'}</h2>
                {colorMode !== 'couverture' && (
                  <span className="muted small">
                    {colorMode === 'commercial'
                      ? plural(model.legend.length, 'commercial', 'commerciaux')
                      : plural(model.legend.length, 'manager')}
                  </span>
                )}
              </div>
              <div className="sidebar-body">
                <Legend
                  items={model.legend}
                  colorMode={colorMode}
                  highlighted={highlighted}
                  onToggle={toggleHighlight}
                  onClear={() => setHighlighted(new Set())}
                  sharedMode={sharedMode}
                  onSharedMode={(m) => setParam('partage', m, 'rayures')}
                />
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

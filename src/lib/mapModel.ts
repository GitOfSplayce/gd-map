// Calcul de ce que la carte affiche : affectations filtrées par zone, couleurs, rayures et légende.
import { managerColors } from './colors'
import { nameKey } from './text'
import type { Affectation, Commercial, Couverture, MapData, Objectif, Structure } from './types'
import { PARIS_ARR_CODES, isParisArr } from './zones'

export type ColorMode = 'commercial' | 'manager1' | 'manager2'
export type Tab = 'ALL' | Structure
export type ManagerField = 'manager1' | 'manager2'

export interface Filters {
  managerField: ManagerField
  managers: string[]
  commerciaux: string[]
  couvertures: Couverture[]
  statuts: string[]
  hideARecruter: boolean
}

export const DEFAULT_FILTERS: Filters = {
  managerField: 'manager1',
  managers: [],
  commerciaux: [],
  couvertures: [],
  statuts: [],
  hideARecruter: false,
}

export const NO_MANAGER = '(sans manager)'

export function activeFilterCount(f: Filters) {
  return f.managers.length + f.commerciaux.length + f.couvertures.length + f.statuts.length + (f.hideARecruter ? 1 : 0)
}

export interface ZoneEntry {
  affectation: Affectation
  commercial: Commercial
  /** Zone réellement saisie (ex. "75" pour un arrondissement couvert via "75 entier"). */
  sourceZone: string
  key: string
}

export interface LegendItem {
  key: string
  label: string
  color: string
  detail: string
  zoneCount: number
}

export interface Stripe {
  color: string
  opacity: number
}

export interface ZoneStyle {
  fill: string
  fillOpacity: number
  stroke: string
  strokeWidth: number
  dash: string | null
  /** Rayures à définir dans <defs> quand plusieurs couleurs se partagent la zone. */
  pattern: { id: string; stripes: Stripe[] } | null
}

export const COUVERTURE_OPACITY: Record<Couverture, number> = { propre: 0.88, partiel: 0.5, gestion: 0.2 }
const COUVERTURE_RANK: Record<Couverture, number> = { propre: 3, partiel: 2, gestion: 1 }
const EMPTY_FILL = '#e9ecf1'
const BORDER = '#ffffff'

export const isARecruter = (c: Commercial) =>
  nameKey(c.statut).startsWith('a recruter') || nameKey(c.nom).startsWith('a recruter')

export const strongest = (list: Couverture[]): Couverture =>
  list.reduce<Couverture>((best, c) => (COUVERTURE_RANK[c] > COUVERTURE_RANK[best] ? c : best), 'gestion')

export interface MapModel {
  /** Entrées par code de zone affichée (départements, arrondissements, DROM, Monaco). */
  entries: Map<string, ZoneEntry[]>
  legend: LegendItem[]
  colorOf: (key: string) => string
  styleOf: (code: string, highlighted: Set<string>) => ZoneStyle
  objectifOf: (commercialId: string, structure: Structure) => Objectif | undefined
  managers: { manager1: string[]; manager2: string[] }
  statuts: string[]
  visibleCommerciaux: Commercial[]
  year: number
}

export function buildMapModel(data: MapData, tab: Tab, filters: Filters, colorMode: ColorMode): MapModel {
  const byId = new Map(data.commerciaux.map((c) => [c.id, c]))
  const active = data.commerciaux.filter((c) => c.actif)

  const m1 = [...new Set(active.map((c) => c.manager1 || NO_MANAGER))].sort((a, b) => a.localeCompare(b, 'fr'))
  const m2 = [...new Set(active.map((c) => c.manager2 || NO_MANAGER))].sort((a, b) => a.localeCompare(b, 'fr'))
  const statuts = [...new Set(active.map((c) => c.statut || '(sans statut)'))].sort((a, b) => a.localeCompare(b, 'fr'))
  const mgrColors = managerColors([...m1, ...m2])

  const keyOf = (c: Commercial) =>
    colorMode === 'commercial' ? c.id : `m:${(colorMode === 'manager1' ? c.manager1 : c.manager2) || NO_MANAGER}`
  const colorOf = (key: string) =>
    key.startsWith('m:') ? (mgrColors.get(key.slice(2)) ?? '#888') : (byId.get(key)?.couleur ?? '#888')

  const keepCommercial = (c: Commercial) => {
    if (!c.actif) return false
    if (tab !== 'ALL' && !c.structures.includes(tab)) return false
    if (filters.hideARecruter && isARecruter(c)) return false
    if (filters.commerciaux.length && !filters.commerciaux.includes(c.id)) return false
    if (filters.statuts.length && !filters.statuts.includes(c.statut || '(sans statut)')) return false
    if (filters.managers.length && !filters.managers.includes(c[filters.managerField] || NO_MANAGER)) return false
    return true
  }

  // Affectations retenues, regroupées par zone saisie
  const bySource = new Map<string, ZoneEntry[]>()
  for (const a of data.affectations) {
    const c = byId.get(a.commercial_id)
    if (!c || !keepCommercial(c)) continue
    if (tab !== 'ALL' && a.structure !== tab) continue
    if (filters.couvertures.length && !filters.couvertures.includes(a.couverture)) continue
    const list = bySource.get(a.zone_code) ?? []
    list.push({ affectation: a, commercial: c, sourceZone: a.zone_code, key: keyOf(c) })
    bySource.set(a.zone_code, list)
  }

  // Zones affichées : "75" entier compte pour chaque arrondissement, et le département 75 regroupe tout Paris
  const entries = new Map<string, ZoneEntry[]>()
  for (const [code, list] of bySource) {
    if (code !== '75') entries.set(code, [...(entries.get(code) ?? []), ...list])
  }
  const paris = bySource.get('75') ?? []
  if (paris.length) {
    for (const arr of PARIS_ARR_CODES) entries.set(arr, [...paris, ...(entries.get(arr) ?? [])])
  }
  const parisAll = [...paris, ...[...bySource].filter(([code]) => isParisArr(code)).flatMap(([, l]) => l)]
  if (parisAll.length) entries.set('75', parisAll)

  // Légende : une ligne par commercial ou par manager, avec le nombre de zones saisies
  const legendZones = new Map<string, Set<string>>()
  const legendPeople = new Map<string, Map<string, Commercial>>()
  for (const [code, list] of bySource) {
    for (const e of list) {
      if (!legendZones.has(e.key)) {
        legendZones.set(e.key, new Set())
        legendPeople.set(e.key, new Map())
      }
      legendZones.get(e.key)!.add(code)
      legendPeople.get(e.key)!.set(e.commercial.id, e.commercial)
    }
  }
  const legend: LegendItem[] = [...legendZones]
    .map(([key, zones]) => {
      const people = [...legendPeople.get(key)!.values()]
      const isManager = key.startsWith('m:')
      return {
        key,
        label: isManager ? key.slice(2) : people[0].nom,
        color: colorOf(key),
        detail: isManager
          ? `${people.length} commercia${people.length > 1 ? 'ux' : 'l'}`
          : [people[0].statut, people[0].structures.join(' · ')].filter(Boolean).join(' – '),
        zoneCount: zones.size,
      }
    })
    .sort((a, b) => {
      if (colorMode !== 'commercial') return a.label.localeCompare(b.label, 'fr')
      return (
        Number(isARecruter(byId.get(a.key)!)) - Number(isARecruter(byId.get(b.key)!)) ||
        a.label.localeCompare(b.label, 'fr')
      )
    })

  const styleCache = new Map<string, ZoneStyle>()
  const styleOf = (code: string, highlighted: Set<string>): ZoneStyle => {
    const list = entries.get(code) ?? []
    const cacheKey = code + '|' + [...highlighted].join(',')
    const cached = styleCache.get(cacheKey)
    if (cached) return cached

    let style: ZoneStyle
    if (!list.length) {
      style = { fill: EMPTY_FILL, fillOpacity: 1, stroke: BORDER, strokeWidth: 0.8, dash: null, pattern: null }
    } else {
      // Une couleur par clé (commercial ou manager), avec sa couverture la plus forte dans la zone
      const perKey = new Map<string, Couverture[]>()
      for (const e of list) perKey.set(e.key, [...(perKey.get(e.key) ?? []), e.affectation.couverture])
      const keys = [...perKey.keys()].sort((a, b) => a.localeCompare(b))
      const stripes = keys.map((k) => ({ color: colorOf(k), opacity: COUVERTURE_OPACITY[strongest(perKey.get(k)!)] }))
      const allGestion = list.every((e) => e.affectation.couverture === 'gestion')

      if (stripes.length === 1) {
        style = {
          fill: stripes[0].color,
          fillOpacity: stripes[0].opacity,
          stroke: allGestion ? stripes[0].color : BORDER,
          strokeWidth: allGestion ? 1.6 : 0.8,
          dash: allGestion ? '4 3' : null,
          pattern: null,
        }
      } else {
        const id = 'stripes-' + stripes.map((s) => s.color.slice(1) + Math.round(s.opacity * 100)).join('-')
        style = {
          fill: `url(#${id})`,
          fillOpacity: 1,
          stroke: allGestion ? '#555' : BORDER,
          strokeWidth: allGestion ? 1.6 : 0.8,
          dash: allGestion ? '4 3' : null,
          pattern: { id, stripes },
        }
      }
    }

    if (highlighted.size) {
      const hit = list.some((e) => highlighted.has(e.key))
      style = hit
        ? { ...style, stroke: '#111', strokeWidth: 1.8 }
        : { ...style, fillOpacity: style.fillOpacity * 0.18, stroke: BORDER, dash: null }
    }

    styleCache.set(cacheKey, style)
    return style
  }

  const years = data.objectifs.map((o) => o.annee)
  const year = years.includes(new Date().getFullYear()) || !years.length ? new Date().getFullYear() : Math.max(...years)
  const objectifOf = (commercialId: string, structure: Structure) =>
    data.objectifs.find((o) => o.commercial_id === commercialId && o.structure === structure && o.annee === year)

  return {
    entries,
    legend,
    colorOf,
    styleOf,
    objectifOf,
    managers: { manager1: m1, manager2: m2 },
    statuts,
    visibleCommerciaux: active.filter(keepCommercial),
    year,
  }
}

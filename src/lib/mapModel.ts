// Calcul de ce que la carte affiche : affectations filtrées par zone, couleurs, zones partagées, couverture et légende.
import { managerColors } from './colors'
import { nameKey } from './text'
import { PERF_BUCKETS, defaultYear, perfBucketOf, sumPerf, type Perf } from './performance'
import { inStructureOrder, structureCodes, type StructureDef } from './structures'
import type { Affectation, Commercial, Couverture, MapData, Objectif, Structure } from './types'
import { PARIS_ARR_CODES, ZONES, isParisArr } from './zones'

/**
 * `couverture` : carte de chaleur du niveau de couverture ; `performance` : taux d'atteinte des objectifs
 * (admins seulement), à la place des couleurs des commerciaux.
 */
export type ColorMode = 'commercial' | 'manager1' | 'manager2' | 'couverture' | 'performance'
/** Affichage des zones partagées par plusieurs commerciaux (ou managers). */
export type SharedMode = 'rayures' | 'decoupage' | 'camemberts' | 'dominante'

export const SHARED_MODES: { key: SharedMode; label: string; detail: string }[] = [
  { key: 'rayures', label: 'Rayures', detail: 'rayures aux couleurs de chacun' },
  { key: 'decoupage', label: 'Découpage', detail: 'une bande par commercial' },
  { key: 'camemberts', label: 'Camemberts', detail: 'zone claire et petit camembert' },
  { key: 'dominante', label: 'Dominante', detail: 'couleur du principal et badge « +2 »' },
]
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
  /** CA et objectif de l'année (admins), pour un commercial ou l'équipe d'un manager. */
  perf?: Perf
}

export interface Stripe {
  color: string
  opacity: number
}

/** Motif à définir dans <defs> : rayures (zone partagée) ou trame de points (gestion, élément de la charte). */
export type ZonePattern = { id: string; kind: 'stripes'; stripes: Stripe[] } | { id: string; kind: 'dots'; color: string }

export interface ZoneStyle {
  fill: string
  fillOpacity: number
  stroke: string
  strokeWidth: number
  pattern: ZonePattern | null
  /** Zone partagée : une part par commercial (ou manager), pour l'affichage en camemberts. */
  slices: Stripe[] | null
}

export const COUVERTURE_OPACITY: Record<Couverture, number> = { propre: 0.88, partiel: 0.5, gestion: 0.3 }

// ---------- Carte de chaleur de la couverture ----------

/** Poids d'un commercial dans une zone selon sa couverture (on additionne les commerciaux distincts). */
export const COVERAGE_WEIGHT: Record<Couverture, number> = { propre: 1, partiel: 0.5, gestion: 0.25 }

export interface HeatBucket {
  key: string
  label: string
  detail: string
  color: string
  /** Score minimal (inclus) pour entrer dans ce niveau. */
  min: number
}

// Du gris (non couvert) au Bleu Saphir (forte couverture), en passant par le Bleu Azurin de la charte
export const HEAT_BUCKETS: HeatBucket[] = [
  { key: 'cov:0', label: 'Non couverte', detail: 'aucun commercial', color: '#e3e8ee', min: 0 },
  { key: 'cov:1', label: 'Faible', detail: 'gestion ou partiel seulement', color: '#cdebf5', min: 0.01 },
  { key: 'cov:2', label: 'Couverte', detail: '≈ 1 commercial', color: '#86c6e3', min: 1 },
  { key: 'cov:3', label: 'Renforcée', detail: '≈ 2 commerciaux', color: '#3f78bd', min: 2 },
  { key: 'cov:4', label: 'Forte', detail: '3 commerciaux ou plus', color: '#1a428a', min: 3 },
]

export const heatBucketOf = (score: number) => [...HEAT_BUCKETS].reverse().find((b) => score >= b.min)!

export interface ZoneCoverage {
  score: number
  people: number
  bucket: HeatBucket
}
const COUVERTURE_RANK: Record<Couverture, number> = { propre: 3, partiel: 2, gestion: 1 }
const EMPTY_FILL = '#e9ecf1'
const BORDER = '#ffffff'

export const isARecruter = (c: Commercial) =>
  nameKey(c.statut).startsWith('a recruter') || nameKey(c.nom).startsWith('a recruter')

export const strongest = (list: Couverture[]): Couverture =>
  list.reduce<Couverture>((best, c) => (COUVERTURE_RANK[c] > COUVERTURE_RANK[best] ? c : best), 'gestion')

export interface MapModel {
  colorMode: ColorMode
  /** Année des CA et objectifs affichés. */
  year: number
  /** Performance des commerciaux présents sur une zone (vue Performance). */
  perfOf: (code: string) => Perf
  perfOfCommercial: (id: string) => Perf
  /** Vue Performance : commerciaux classés par taux d'atteinte. */
  ranking: LegendItem[]
  /** Entrées par code de zone affichée (départements, arrondissements, DROM, Monaco). */
  entries: Map<string, ZoneEntry[]>
  coverageOf: (code: string) => ZoneCoverage
  legend: LegendItem[]
  colorOf: (key: string) => string
  styleOf: (code: string, highlighted: Set<string>) => ZoneStyle
  objectifOf: (commercialId: string, structure: Structure) => Objectif | undefined
  /** Structures dans l'ordre choisi par les admins. */
  structures: StructureDef[]
  managers: { manager1: string[]; manager2: string[] }
  statuts: string[]
  visibleCommerciaux: Commercial[]
}

export function buildMapModel(
  data: MapData,
  tab: Tab,
  filters: Filters,
  colorMode: ColorMode,
  year: number = defaultYear(data.objectifs),
): MapModel {
  const order = structureCodes(data.structures)
  const structs: readonly Structure[] = tab === 'ALL' ? order : [tab]
  /** « MD · SP », dans l'ordre des structures. */
  const structuresText = (c: Commercial) => inStructureOrder(c.structures, order).join(' · ')
  const perfOfPeople = (ids: Iterable<string>) => sumPerf(data.objectifs, ids, year, structs)
  const hasFigures = data.objectifs.length > 0
  const byId = new Map(data.commerciaux.map((c) => [c.id, c]))
  const active = data.commerciaux.filter((c) => c.actif)

  const m1 = [...new Set(active.map((c) => c.manager1 || NO_MANAGER))].sort((a, b) => a.localeCompare(b, 'fr'))
  const m2 = [...new Set(active.map((c) => c.manager2 || NO_MANAGER))].sort((a, b) => a.localeCompare(b, 'fr'))
  const statuts = [...new Set(active.map((c) => c.statut || '(sans statut)'))].sort((a, b) => a.localeCompare(b, 'fr'))
  const mgrColors = managerColors([...m1, ...m2], data.managers ?? [])

  const keyOf = (c: Commercial) =>
    colorMode === 'commercial' || colorMode === 'couverture' || colorMode === 'performance'
      ? c.id
      : `m:${(colorMode === 'manager1' ? c.manager1 : c.manager2) || NO_MANAGER}`
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

  // Couverture : somme des poids des commerciaux distincts ; le département 75 vaut la moyenne de ses arrondissements
  const coverageCache = new Map<string, ZoneCoverage>()
  const coverageOf = (code: string): ZoneCoverage => {
    const cached = coverageCache.get(code)
    if (cached) return cached
    let score: number
    let people: number
    if (code === '75') {
      const arrs = PARIS_ARR_CODES.map(coverageOf)
      score = arrs.reduce((sum, a) => sum + a.score, 0) / arrs.length
      people = new Set((entries.get('75') ?? []).map((e) => e.commercial.id)).size
    } else {
      const perPerson = new Map<string, Couverture[]>()
      for (const e of entries.get(code) ?? []) {
        perPerson.set(e.commercial.id, [...(perPerson.get(e.commercial.id) ?? []), e.affectation.couverture])
      }
      score = [...perPerson.values()].reduce((sum, list) => sum + COVERAGE_WEIGHT[strongest(list)], 0)
      people = perPerson.size
    }
    const result = { score, people, bucket: heatBucketOf(score) }
    coverageCache.set(code, result)
    return result
  }

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
  // Performance d'une zone : CA et objectifs cumulés des commerciaux qui y sont présents
  const perfCache = new Map<string, Perf>()
  const perfOf = (code: string) => {
    let p = perfCache.get(code)
    if (!p) {
      p = perfOfPeople(new Set((entries.get(code) ?? []).map((e) => e.commercial.id)))
      perfCache.set(code, p)
    }
    return p
  }

  const franceZones = ZONES.filter((z) => z.type !== 'arrondissement')
  const perfLegend: LegendItem[] = PERF_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    color: b.color,
    detail: b.detail,
    zoneCount: franceZones.filter((z) => (entries.get(z.code)?.length ?? 0) > 0 && perfBucketOf(perfOf(z.code).pct).key === b.key).length,
  }))

  // En mode couverture : un niveau par ligne, compté sur les départements, DROM et Monaco
  const heatLegend: LegendItem[] = HEAT_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    color: b.color,
    detail: b.detail,
    zoneCount: ZONES.filter((z) => z.type !== 'arrondissement' && coverageOf(z.code).bucket.key === b.key).length,
  }))

  const legend: LegendItem[] = colorMode === 'couverture' ? heatLegend : colorMode === 'performance' ? perfLegend : [...legendZones]
    .map(([key, zones]) => {
      const people = [...legendPeople.get(key)!.values()]
      const isManager = key.startsWith('m:')
      return {
        key,
        label: isManager ? key.slice(2) : people[0].nom,
        color: colorOf(key),
        detail: isManager
          ? `${people.length} commercia${people.length > 1 ? 'ux' : 'l'}`
          : [people[0].statut, structuresText(people[0])].filter(Boolean).join(' – '),
        zoneCount: zones.size,
        perf: hasFigures ? perfOfPeople(people.map((p) => p.id)) : undefined,
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
    if (colorMode === 'performance') {
      const color = list.length ? perfBucketOf(perfOf(code).pct).color : EMPTY_FILL
      style = { fill: color, fillOpacity: 1, stroke: BORDER, strokeWidth: 0.8, pattern: null, slices: null }
    } else if (colorMode === 'couverture') {
      style = { fill: coverageOf(code).bucket.color, fillOpacity: 1, stroke: BORDER, strokeWidth: 0.8, pattern: null, slices: null }
    } else if (!list.length) {
      style = { fill: EMPTY_FILL, fillOpacity: 1, stroke: BORDER, strokeWidth: 0.8, pattern: null, slices: null }
    } else {
      // Une couleur par clé (commercial ou manager), avec sa couverture la plus forte dans la zone
      const perKey = new Map<string, Couverture[]>()
      for (const e of list) perKey.set(e.key, [...(perKey.get(e.key) ?? []), e.affectation.couverture])
      const keys = [...perKey.keys()].sort((a, b) => a.localeCompare(b))
      const stripes = keys.map((k) => ({ color: colorOf(k), opacity: COUVERTURE_OPACITY[strongest(perKey.get(k)!)] }))
      const allGestion = list.every((e) => e.affectation.couverture === 'gestion')

      if (stripes.length === 1 && allGestion) {
        // Gestion : trame de points sur fond teinté (élément graphique de la charte)
        const color = stripes[0].color
        const id = 'dots-' + color.slice(1)
        style = { fill: `url(#${id})`, fillOpacity: 1, stroke: BORDER, strokeWidth: 0.8, pattern: { id, kind: 'dots', color }, slices: null }
      } else if (stripes.length === 1) {
        style = { fill: stripes[0].color, fillOpacity: stripes[0].opacity, stroke: BORDER, strokeWidth: 0.8, pattern: null, slices: null }
      } else {
        const id = 'stripes-' + stripes.map((s) => s.color.slice(1) + Math.round(s.opacity * 100)).join('-')
        style = {
          fill: `url(#${id})`,
          fillOpacity: 1,
          stroke: BORDER,
          strokeWidth: 0.8,
          pattern: { id, kind: 'stripes', stripes },
          slices: stripes,
        }
      }
    }

    if (highlighted.size) {
      const hit =
        colorMode === 'couverture'
          ? highlighted.has(coverageOf(code).bucket.key)
          : (colorMode === 'performance' && list.length > 0 && highlighted.has(perfBucketOf(perfOf(code).pct).key)) ||
            list.some((e) => highlighted.has(e.key))
      style = hit
        ? { ...style, stroke: '#1b2232', strokeWidth: 1.8 }
        : { ...style, fillOpacity: style.fillOpacity * 0.18, stroke: BORDER }
    }

    styleCache.set(cacheKey, style)
    return style
  }

  const objectifOf = (commercialId: string, structure: Structure) =>
    data.objectifs.find((o) => o.commercial_id === commercialId && o.structure === structure && o.annee === year)

  const visibleCommerciaux = active.filter(keepCommercial)

  // Classement de la vue Performance : commerciaux visibles ayant des chiffres, du meilleur taux au plus faible
  const ranking: LegendItem[] = visibleCommerciaux
    .map((c) => ({ c, perf: perfOfPeople([c.id]) }))
    .filter((x) => x.perf.hasData)
    .sort((a, b) => (b.perf.pct ?? -1) - (a.perf.pct ?? -1) || a.c.nom.localeCompare(b.c.nom, 'fr'))
    .map(({ c, perf }) => ({
      key: c.id,
      label: c.nom,
      color: perfBucketOf(perf.pct).color,
      detail: [c.statut, structuresText(c)].filter(Boolean).join(' – '),
      zoneCount: new Set(data.affectations.filter((a) => a.commercial_id === c.id).map((a) => a.zone_code)).size,
      perf,
    }))

  return {
    colorMode,
    entries,
    coverageOf,
    legend,
    colorOf,
    styleOf,
    objectifOf,
    structures: data.structures,
    managers: { manager1: m1, manager2: m2 },
    statuts,
    visibleCommerciaux,
    year,
    perfOf,
    perfOfCommercial: (id: string) => perfOfPeople([id]),
    ranking,
  }
}

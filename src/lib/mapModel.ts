// Calcul de ce que la carte affiche : affectations filtrées par zone, couleurs, zones partagées, couverture et légende.
import { managerColors } from './colors'
import { activeManagers, fichesOf, managerLabel, teamManager, type ManagerField } from './managers'
import { isARecruter, occupancyOf, prioriteColor, prioriteLabel, vacancyIn, type Vacancy } from './recrutement'
import { PERF_BUCKETS, defaultYear, perfBucketOf, sumPerf, type Perf } from './performance'
import { inStructureOrder, structureCodes, type StructureDef } from './structures'
import type { Affectation, Commercial, Couverture, Manager, MapData, Objectif, Priorite, Structure } from './types'
import { PARIS_ARR_CODES, ZONES, compareZoneCodes, isParisArr } from './zones'

/**
 * `couverture` : carte de chaleur du niveau de couverture ; `performance` : taux d'atteinte des objectifs
 * (admins et managers), à la place des couleurs des commerciaux. Les vues Manager suivent les réglages.
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

/** Une zone saisie et sa couverture la plus forte ; null quand personne ne l'a (à recruter). */
export interface ZoneRef {
  code: string
  couverture: Couverture | null
}

export interface LegendItem {
  key: string
  label: string
  color: string
  detail: string
  zoneCount: number
  /** Ses zones, dans l'ordre (vide pour un niveau de couverture ou de performance). */
  zones: ZoneRef[]
  /** CA et objectif de l'année (admins et managers), pour un commercial ou l'équipe d'un manager. */
  perf?: Perf
  /** Départements à recruter : regroupés à part dans la légende et l'export PNG. */
  group?: 'a-recruter'
  /** Libellé court, sous le titre « À recruter » (« Centre » pour « À recruter – Centre »). */
  shortLabel?: string
}

export const LEGEND_GROUP_TITLES: Record<NonNullable<LegendItem['group']>, string> = { 'a-recruter': 'À recruter' }

/** « À recruter – Centre » → « Centre » ; le nom entier s'il ne commence pas par « À recruter ». */
export function aRecruterShortLabel(nom: string): string {
  const rest = nom.replace(/^\s*[aà]\s+recruter\s*[-–—:]?\s*/i, '').trim()
  return rest || nom
}

/** Un groupe de départements à recruter : entouré et nommé sur la carte. */
export interface MapGroup {
  key: string
  label: string
  color: string
  codes: string[]
}

/** Contour et nom d'un groupe sans priorité : plus foncé que ses hachures, pour se lire dessus. */
export const groupColor = (p: Priorite | null) => (p === null ? '#4b5869' : prioriteColor(p))

/** Clé de légende d'un département à recruter : son groupe, ou sa priorité. */
const sectorKey = (structure: Structure, secteur: string) => `r:${structure}|${secteur}`
const priorityKey = (p: Priorite | null) => `r:p${p ?? 0}`

/** Rendu d'une part de zone : couleur pleine (propre, partiel), trame de points (gestion), traits pointillés (gestion-partiel) ou blanc. */
export type SliceKind = 'plein' | 'points' | 'tirets' | 'blanc'

export interface Stripe {
  color: string
  opacity: number
  kind: SliceKind
  /** Force de la couverture : désigne le commercial principal (affichage « Dominante »). */
  rank: number
}

/** Part blanche d'un partiel seul sur sa zone : « personne d'autre » (le blanc n'est la couleur de personne). */
export const NEUTRAL_SLICE: Stripe = { color: '#ffffff', opacity: 1, kind: 'blanc', rank: 0 }

/** Motif à définir dans <defs> : rayures (zone partagée ou partielle), trame de points (gestion), traits pointillés (gestion-partiel). */
export type ZonePattern =
  | { id: string; kind: 'stripes'; stripes: Stripe[] }
  | { id: string; kind: 'dots'; color: string }
  | { id: string; kind: 'dashes'; color: string }
  /** Département à recruter avec une priorité : hachures à sa couleur, dans l'autre sens que les zones partagées. */
  | { id: string; kind: 'hatch'; color: string }

export const hatchId = (color: string) => 'hatch-' + color.slice(1)
export const dotsId = (color: string) => 'dots-' + color.slice(1)
export const dashesId = (color: string) => 'dashes-' + color.slice(1)
export const stripesId = (slices: Stripe[]) => 'stripes-' + slices.map((s) => s.kind[0] + s.color.slice(1) + Math.round(s.opacity * 100)).join('-')

export interface ZoneStyle {
  fill: string
  fillOpacity: number
  stroke: string
  strokeWidth: number
  pattern: ZonePattern | null
  /** Zone partagée : une part par commercial (ou manager), pour l'affichage en camemberts. */
  slices: Stripe[] | null
}

/** Teinte selon la couverture : le partiel garde sa couleur pleine, ce sont ses rayures qui le distinguent. */
export const COUVERTURE_OPACITY: Record<Couverture, number> = { propre: 0.88, partiel: 0.88, gestion: 0.3, gestion_partiel: 0.88 }

const SLICE_KIND: Record<Couverture, SliceKind> = { propre: 'plein', partiel: 'plein', gestion: 'points', gestion_partiel: 'tirets' }

/** Partiel et gestion-partiel : jamais seuls sur une zone, ils s'affichent comme une zone partagée. */
export const isPartial = (c: Couverture) => c === 'partiel' || c === 'gestion_partiel'

// ---------- Carte de chaleur de la couverture ----------

/** Poids d'un commercial dans une zone selon sa couverture (on additionne les commerciaux distincts). */
export const COVERAGE_WEIGHT: Record<Couverture, number> = { propre: 1, partiel: 0.5, gestion: 0.25, gestion_partiel: 0.125 }

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
const COUVERTURE_RANK: Record<Couverture, number> = { propre: 4, partiel: 3, gestion: 2, gestion_partiel: 1 }

/** Part d'une zone pour un commercial (ou un manager) selon sa couverture. */
export const sliceOf = (color: string, c: Couverture): Stripe => ({
  color,
  opacity: COUVERTURE_OPACITY[c],
  kind: SLICE_KIND[c],
  rank: COUVERTURE_RANK[c],
})
const EMPTY_FILL = '#e9ecf1'
const BORDER = '#ffffff'

export const strongest = (list: Couverture[]): Couverture =>
  list.reduce<Couverture>((best, c) => (COUVERTURE_RANK[c] > COUVERTURE_RANK[best] ? c : best), list[0] ?? 'propre')

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
  /** Fiche d'un manager (couleur, téléphone, e-mail) d'après son nom. */
  managerOf: (nom: string | null | undefined) => Manager | undefined
  managers: { manager1: string[]; manager2: string[] }
  /** Les managers actifs, et leur nom à l'écran (« Manager » quand il n'en reste qu'un). */
  activeManagers: ManagerField[]
  managerLabel: (field: ManagerField) => string
  /** Groupes de départements à recruter, à entourer sur la carte. */
  groups: MapGroup[]
  /** Vrai si une zone vide se lit « à recruter » (un filtre sur des personnes ne le dit plus). */
  showsRecruit: boolean
  /** Ce que chaque structure de l'onglet a à recruter dans une zone (sans tenir compte des filtres). */
  vacanciesOf: (code: string) => Vacancy[]
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
  const activeFields = activeManagers(data.settings)

  // La fiche d'un manager compte dans sa propre équipe (D-013)
  const fiches = fichesOf(data.managers)
  const teamOf = (c: Commercial, field: ManagerField) => teamManager(c, field, fiches) || NO_MANAGER
  const m1 = [...new Set(active.map((c) => teamOf(c, 'manager1')))].sort((a, b) => a.localeCompare(b, 'fr'))
  const m2 = [...new Set(active.map((c) => teamOf(c, 'manager2')))].sort((a, b) => a.localeCompare(b, 'fr'))
  const statuts = [...new Set(active.map((c) => c.statut || '(sans statut)'))].sort((a, b) => a.localeCompare(b, 'fr'))
  // « (sans manager) » n'a pas de couleur à lui : il décalerait celles des autres
  const mgrColors = managerColors([...m1, ...m2].filter((nom) => nom !== NO_MANAGER), data.managers ?? [])
  const managersByName = new Map((data.managers ?? []).map((m) => [m.nom, m]))

  const keyOf = (c: Commercial) =>
    colorMode === 'commercial' || colorMode === 'couverture' || colorMode === 'performance'
      ? c.id
      : `m:${teamOf(c, colorMode)}`
  const colorOf = (key: string) =>
    key.startsWith('m:') ? (mgrColors.get(key.slice(2)) ?? '#888') : (byId.get(key)?.couleur ?? '#888')

  const keepCommercial = (c: Commercial) => {
    if (!c.actif) return false
    if (tab !== 'ALL' && !c.structures.includes(tab)) return false
    if (filters.hideARecruter && isARecruter(c)) return false
    if (filters.commerciaux.length && !filters.commerciaux.includes(c.id)) return false
    if (filters.statuts.length && !filters.statuts.includes(c.statut || '(sans statut)')) return false
    if (filters.managers.length && !filters.managers.includes(teamOf(c, filters.managerField))) return false
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

  // À recruter : vide pour toutes les structures de l'onglet (une seule suffit à occuper la vue globale).
  // Un filtre sur des personnes ne montre qu'elles : le reste n'est pas « à recruter » pour autant.
  const occupancy = occupancyOf(data)
  const rows = data.a_recruter ?? []
  const vacancyCache = new Map<string, Vacancy[]>()
  const vacanciesOf = (code: string) => {
    let list = vacancyCache.get(code)
    if (!list) {
      list = structs.map((s) => vacancyIn(code, s, occupancy, rows)).filter((v): v is Vacancy => v !== null)
      vacancyCache.set(code, list)
    }
    return list
  }
  const showRecruit =
    (colorMode === 'commercial' || colorMode === 'manager1' || colorMode === 'manager2') &&
    !filters.hideARecruter &&
    !filters.managers.length &&
    !filters.commerciaux.length &&
    !filters.couvertures.length &&
    !filters.statuts.length
  const recruitOf = (code: string): { priorite: Priorite | null; keys: string[] } | null => {
    if (!showRecruit) return null
    const list = vacanciesOf(code)
    if (list.length < structs.length || list.some((v) => v.arrondissements)) return null
    const known = list.filter((v) => v.priorite !== null || v.secteurs.length)
    if (!known.length) return null
    const priorites = known.map((v) => v.priorite).filter((p): p is Priorite => p !== null)
    return {
      priorite: priorites.length ? (Math.min(...priorites) as Priorite) : null,
      keys: known.flatMap((v) => (v.secteurs.length ? v.secteurs.map((s) => sectorKey(v.structure, s)) : [priorityKey(v.priorite)])),
    }
  }

  // Légende : une ligne par commercial ou par manager, avec le nombre de zones saisies
  const legendZones = new Map<string, Map<string, Couverture[]>>()
  const legendPeople = new Map<string, Map<string, Commercial>>()
  for (const [code, list] of bySource) {
    for (const e of list) {
      if (!legendZones.has(e.key)) {
        legendZones.set(e.key, new Map())
        legendPeople.set(e.key, new Map())
      }
      const zones = legendZones.get(e.key)!
      zones.set(code, [...(zones.get(code) ?? []), e.affectation.couverture])
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
    zones: [],
  }))

  // En mode couverture : un niveau par ligne, compté sur les départements, DROM et Monaco
  const heatLegend: LegendItem[] = HEAT_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    color: b.color,
    detail: b.detail,
    zoneCount: ZONES.filter((z) => z.type !== 'arrondissement' && coverageOf(z.code).bucket.key === b.key).length,
    zones: [],
  }))

  // Une ligne par groupe à recruter, puis une par priorité pour les départements sans groupe
  const recruits = new Map<string, { structure: Structure; secteur: string | null; priorites: Set<Priorite | null>; zones: Set<string> }>()
  for (const r of rows) {
    if (!structs.includes(r.structure) || !recruitOf(r.zone_code)) continue
    const key = r.secteur ? sectorKey(r.structure, r.secteur) : priorityKey(r.priorite)
    const group = recruits.get(key) ?? { structure: r.structure, secteur: r.secteur, priorites: new Set(), zones: new Set() }
    recruits.set(key, group)
    group.priorites.add(r.priorite)
    group.zones.add(r.zone_code)
  }
  const recruitLegend: (LegendItem & { rank: number })[] = [...recruits].map(([key, g]) => {
    const priorites = [...g.priorites].filter((p): p is Priorite => p !== null).sort()
    const top = priorites[0] ?? null
    return {
      key,
      rank: (g.secteur ? 0 : 10) + (top ?? 4),
      group: 'a-recruter' as const,
      label: g.secteur ? `À recruter – ${g.secteur}` : prioriteLabel(top),
      shortLabel: g.secteur ? (tab === 'ALL' ? `${g.secteur} (${g.structure})` : g.secteur) : prioriteLabel(top),
      color: prioriteColor(top),
      detail: g.secteur ? (priorites.length ? priorites.map(prioriteLabel).join(', ') : 'sans priorité') : 'sans groupe',
      zoneCount: g.zones.size,
      zones: [...g.zones].sort(compareZoneCodes).map((code) => ({ code, couverture: null })),
    }
  })
  const groups: MapGroup[] = [...recruits].flatMap(([key, g]) => {
    if (!g.secteur) return []
    const priorites = [...g.priorites].filter((p): p is Priorite => p !== null).sort()
    return [{ key, label: tab === 'ALL' ? `${g.secteur} (${g.structure})` : g.secteur, color: groupColor(priorites[0] ?? null), codes: [...g.zones] }]
  })
  recruitLegend.sort((a, b) => a.rank - b.rank || a.shortLabel!.localeCompare(b.shortLabel!, 'fr'))

  const people: LegendItem[] = colorMode === 'couverture' ? heatLegend : colorMode === 'performance' ? perfLegend : [...legendZones]
    .map(([key, zones]) => {
      const team = [...legendPeople.get(key)!.values()]
      const isManager = key.startsWith('m:')
      const recruit = colorMode === 'commercial' && isARecruter(team[0])
      return {
        key,
        ...(recruit && { group: 'a-recruter' as const, shortLabel: aRecruterShortLabel(team[0].nom) }),
        label: isManager ? key.slice(2) : team[0].nom,
        color: colorOf(key),
        detail: isManager
          ? `${team.length} commercia${team.length > 1 ? 'ux' : 'l'}`
          : [!recruit && team[0].statut, structuresText(team[0])].filter(Boolean).join(' – '),
        zoneCount: zones.size,
        zones: [...zones].map(([code, list]) => ({ code, couverture: strongest(list) })).sort((a, b) => compareZoneCodes(a.code, b.code)),
        perf: hasFigures ? perfOfPeople(team.map((p) => p.id)) : undefined,
      }
    })
    .sort((a, b) => {
      if (colorMode !== 'commercial') return a.label.localeCompare(b.label, 'fr')
      return (
        Number(isARecruter(byId.get(a.key)!)) - Number(isARecruter(byId.get(b.key)!)) ||
        a.label.localeCompare(b.label, 'fr')
      )
    })
  const legend: LegendItem[] = [...people, ...recruitLegend.map(({ rank: _rank, ...item }) => item)]

  const styleCache = new Map<string, ZoneStyle>()
  const styleOf = (code: string, highlighted: Set<string>): ZoneStyle => {
    const list = entries.get(code) ?? []
    const recruit = list.length ? null : recruitOf(code)
    const cacheKey = code + '|' + [...highlighted].join(',')
    const cached = styleCache.get(cacheKey)
    if (cached) return cached

    let style: ZoneStyle
    if (colorMode === 'performance') {
      const color = list.length ? perfBucketOf(perfOf(code).pct).color : EMPTY_FILL
      style = { fill: color, fillOpacity: 1, stroke: BORDER, strokeWidth: 0.8, pattern: null, slices: null }
    } else if (colorMode === 'couverture') {
      style = { fill: coverageOf(code).bucket.color, fillOpacity: 1, stroke: BORDER, strokeWidth: 0.8, pattern: null, slices: null }
    } else if (recruit?.priorite) {
      // Rayé : une priorité. Sans priorité, le département reste gris ; son groupe, s'il en a un, l'entoure.
      const color = prioriteColor(recruit.priorite)
      const id = hatchId(color)
      style = { fill: `url(#${id})`, fillOpacity: 1, stroke: BORDER, strokeWidth: 0.8, pattern: { id, kind: 'hatch', color }, slices: null }
    } else if (!list.length) {
      style = { fill: EMPTY_FILL, fillOpacity: 1, stroke: BORDER, strokeWidth: 0.8, pattern: null, slices: null }
    } else {
      // Une couleur par clé (commercial ou manager), avec sa couverture la plus forte dans la zone
      const perKey = new Map<string, Couverture[]>()
      for (const e of list) perKey.set(e.key, [...(perKey.get(e.key) ?? []), e.affectation.couverture])
      const keys = [...perKey.keys()].sort((a, b) => a.localeCompare(b))
      const coverages = keys.map((k) => strongest(perKey.get(k)!))
      const slices = keys.map((k, i) => sliceOf(colorOf(k), coverages[i]))
      // Partiel seul sur sa zone : rayé avec du blanc, la part de « personne d'autre »
      if (keys.length === 1 && isPartial(coverages[0])) slices.push(NEUTRAL_SLICE)

      if (slices.length === 1 && slices[0].kind === 'points') {
        // Gestion seule : trame de points sur fond teinté (élément graphique de la charte)
        const { color } = slices[0]
        const id = dotsId(color)
        style = { fill: `url(#${id})`, fillOpacity: 1, stroke: BORDER, strokeWidth: 0.8, pattern: { id, kind: 'dots', color }, slices: null }
      } else if (slices.length === 1) {
        style = { fill: slices[0].color, fillOpacity: slices[0].opacity, stroke: BORDER, strokeWidth: 0.8, pattern: null, slices: null }
      } else {
        const id = stripesId(slices)
        style = {
          fill: `url(#${id})`,
          fillOpacity: 1,
          stroke: BORDER,
          strokeWidth: 0.8,
          pattern: { id, kind: 'stripes', stripes: slices },
          slices,
        }
      }
    }

    if (highlighted.size) {
      const hit =
        colorMode === 'couverture'
          ? highlighted.has(coverageOf(code).bucket.key)
          : (colorMode === 'performance' && list.length > 0 && highlighted.has(perfBucketOf(perfOf(code).pct).key)) ||
            list.some((e) => highlighted.has(e.key)) ||
            Boolean(recruit?.keys.some((key) => highlighted.has(key)))
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
      zones: [],
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
    managerOf: (nom) => (nom ? managersByName.get(nom) : undefined),
    managers: { manager1: m1, manager2: m2 },
    activeManagers: activeFields,
    managerLabel: (field) => managerLabel(field, activeFields),
    vacanciesOf,
    groups,
    showsRecruit: showRecruit,
    statuts,
    visibleCommerciaux,
    year,
    perfOf,
    perfOfCommercial: (id: string) => perfOfPeople([id]),
    ranking,
  }
}

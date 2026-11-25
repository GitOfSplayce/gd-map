// Légende de l'export PNG : ce qu'elle dit (motifs, personnes, départements à recruter), puis sa mise en
// colonnes. Rien ici ne dessine (voir exportPng.ts).
import { SHARED_MODES, type LegendItem, type MapModel, type SharedMode, type ZoneRef, strongest } from './mapModel'
import { PRIORITES, NO_PRIORITY_COLOR } from './recrutement'
import { SUFFIX_OF } from './parseZones'
import { perfBucketOf } from './performance'
import { plural } from './text'
import { COUVERTURES, COUVERTURE_LABELS, type Couverture } from './types'
import { compareZoneCodes, isParisArr } from './zones'

/** Pastille, dessinée comme sur la carte. */
export type Swatch =
  | { kind: 'couleur'; color: string }
  | { kind: 'couverture'; couverture: Couverture }
  | { kind: 'partage'; mode: SharedMode }
  /** À recruter : rayé à la couleur de sa priorité (`color` null : gris), entouré s'il a un groupe. */
  | { kind: 'recruter'; color: string | null; outline: string | null }

/** Morceau de texte ; `strong` : la lettre d'une couverture. */
export interface Segment {
  text: string
  strong?: boolean
}
/** Un département (« 52G ») ou une suite d'arrondissements (« 75-1 à 75-6 ») : jamais coupé en fin de ligne. */
export type ZoneToken = Segment[]

export interface LegendEntry {
  label: string
  swatch: Swatch
  detail?: string
  count?: string
  zones?: ZoneToken[]
}

export interface LegendSection {
  title: string
  entries: LegendEntry[]
}

export interface LegendOptions {
  /** Codes des zones visibles sur l'image. */
  shown: ReadonlySet<string>
  sharedMode: SharedMode
  /** Lignes mises en évidence (toutes si vide). */
  highlighted: ReadonlySet<string>
  /** Option de l'export : les départements de chacun, sous son nom. */
  withZones: boolean
}

/** Les départements d'une personne, dans l'ordre, avec la lettre de leur couverture (rien en propre). */
export function zoneTokens(zones: readonly ZoneRef[]): ZoneToken[] {
  const part = (z: ZoneRef): Segment[] => {
    const suffix = z.couverture ? SUFFIX_OF[z.couverture] : ''
    return suffix ? [{ text: z.code }, { text: suffix, strong: true }] : [{ text: z.code }]
  }
  const out: ZoneToken[] = []
  for (let i = 0; i < zones.length; ) {
    // Trois arrondissements qui se suivent, ou plus, avec la même couverture : « 75-1 à 75-6 »
    let end = i
    if (isParisArr(zones[i].code)) {
      const number = (z: ZoneRef) => Number(z.code.slice(3))
      while (
        end + 1 < zones.length &&
        isParisArr(zones[end + 1].code) &&
        zones[end + 1].couverture === zones[i].couverture &&
        number(zones[end + 1]) === number(zones[end]) + 1
      )
        end++
    }
    if (end - i >= 2) {
      out.push([...part(zones[i]), { text: ' à ' }, ...part(zones[end])])
      i = end + 1
    } else {
      out.push(part(zones[i]))
      i++
    }
  }
  return out
}

const PEOPLE_TITLES = { commercial: 'Commerciaux', couverture: 'Niveau de couverture' } as const

function peopleTitle(model: MapModel): string {
  const mode = model.colorMode
  if (mode === 'performance') return `Objectif ${model.year}`
  if (mode === 'manager1' || mode === 'manager2') return model.activeManagers.length > 1 ? model.managerLabel(mode) : 'Managers'
  return PEOPLE_TITLES[mode]
}

/** Les motifs présents sur l'image, et eux seuls. */
function keyEntries(model: MapModel, { shown, sharedMode, withZones }: LegendOptions): LegendEntry[] {
  const coverages = new Set<Couverture>()
  let shared = false
  const hatches = new Set<string>()
  let grey = false
  const none = new Set<string>()
  for (const code of shown) {
    const list = model.entries.get(code) ?? []
    if (!list.length) {
      const { pattern } = model.styleOf(code, none)
      if (pattern?.kind === 'hatch') hatches.add(pattern.color)
      else grey = true
      continue
    }
    const perKey = new Map<string, Couverture[]>()
    for (const e of list) perKey.set(e.key, [...(perKey.get(e.key) ?? []), e.affectation.couverture])
    for (const list of perKey.values()) coverages.add(strongest(list))
    if (perKey.size > 1) shared = true
  }

  const out: LegendEntry[] = COUVERTURES.filter((c) => coverages.has(c)).map((couverture) => ({
    label: COUVERTURE_LABELS[couverture] + (withZones && SUFFIX_OF[couverture] ? ` (${SUFFIX_OF[couverture]})` : ''),
    swatch: { kind: 'couverture', couverture },
  }))
  if (shared) {
    const { detail } = SHARED_MODES.find((m) => m.key === sharedMode)!
    const byManager = model.colorMode === 'manager1' || model.colorMode === 'manager2'
    out.push({ label: 'Zone partagée', detail: byManager ? detail.replace('commercial', 'manager') : detail, swatch: { kind: 'partage', mode: sharedMode } })
  }
  if (!model.showsRecruit) return out
  for (const p of PRIORITES) {
    if (hatches.has(p.color)) out.push({ label: `À recruter, ${p.label.toLowerCase()}`, swatch: { kind: 'recruter', color: p.color, outline: null } })
  }
  if (grey) out.push({ label: 'À recruter, sans priorité', swatch: { kind: 'recruter', color: null, outline: null } })
  if (model.groups.some((g) => g.codes.some((code) => isShown(code, shown)))) {
    out.push({ label: 'Groupe à recruter', detail: 'départements entourés ensemble', swatch: { kind: 'recruter', color: null, outline: '#4b5869' } })
  }
  return out
}

/** Paris se voit d'un bloc (75) sur la France, par arrondissement ailleurs. */
function isShown(code: string, shown: ReadonlySet<string>) {
  if (shown.has(code)) return true
  if (code === '75') return [...shown].some(isParisArr)
  return isParisArr(code) && shown.has('75')
}

export function exportLegend(model: MapModel, options: LegendOptions): LegendSection[] {
  const { shown, highlighted, withZones } = options
  const mode = model.colorMode
  const kept = (item: LegendItem) => !highlighted.size || highlighted.has(item.key)

  if (mode === 'couverture' || mode === 'performance') {
    const bucketOf = (code: string) =>
      mode === 'couverture' ? model.coverageOf(code).bucket.key : model.entries.get(code)?.length ? perfBucketOf(model.perfOf(code).pct).key : null
    const entries = model.legend.filter(kept).map((item): LegendEntry => {
      const zones = item.zones.length ? item.zones : levelZones(shown, (code) => bucketOf(code) === item.key)
      return {
        label: item.label,
        swatch: { kind: 'couleur', color: item.color },
        detail: item.detail,
        count: plural(zones.length, 'zone'),
        ...(withZones && { zones: zoneTokens(zones) }),
      }
    })
    return [{ title: peopleTitle(model), entries }].filter((s) => s.entries.length)
  }

  const visible = model.legend.filter((item) => kept(item) && item.zones.some((z) => isShown(z.code, shown)))
  const groups = new Map(model.groups.map((g) => [g.key, g]))
  const toEntry = (item: LegendItem): LegendEntry => {
    const group = groups.get(item.key)
    const recruit = item.key.startsWith('r:')
    const color = item.color === NO_PRIORITY_COLOR ? null : item.color
    return {
      label: item.shortLabel ?? item.label,
      swatch: recruit ? { kind: 'recruter', color, outline: group?.color ?? null } : { kind: 'couleur', color: item.color },
      ...(group && color && { detail: item.detail }),
      count: plural(item.zoneCount, 'zone'),
      ...(withZones && { zones: zoneTokens(item.zones) }),
    }
  }
  return [
    { title: 'Lecture de la carte', entries: keyEntries(model, options) },
    { title: peopleTitle(model), entries: visible.filter((i) => !i.group).map(toEntry) },
    { title: 'À recruter', entries: visible.filter((i) => i.group).map(toEntry) },
  ].filter((s) => s.entries.length)
}

/** Les zones de l'image à un niveau de couverture ou de performance. */
function levelZones(shown: ReadonlySet<string>, match: (code: string) => boolean): ZoneRef[] {
  return [...shown].filter(match).sort(compareZoneCodes).map((code) => ({ code, couverture: null }))
}

// ---------- Mise en colonnes ----------

/** Une ligne placée : le titre de la section (`entry` null) ou une de ses entrées. */
export interface Placed {
  section: number
  entry: number | null
  /** Titre répété en haut d'une colonne : la section continue. */
  suite: boolean
  y: number
}

export interface ColumnSizes {
  title: number
  /** Espace au-dessus d'un titre, sauf en haut d'une colonne. */
  gap: number
}

/** Répartit les sections en colonnes de `height` : un titre n'est jamais seul en bas, et se répète en haut. */
export function packColumns(heights: readonly (readonly number[])[], height: number, sizes: ColumnSizes): { columns: Placed[][]; used: number } {
  const columns: Placed[][] = [[]]
  let y = 0
  let used = 0
  heights.forEach((entries, section) => {
    entries.forEach((h, entry) => {
      const first = entry === 0
      const lead = first ? (y > 0 ? sizes.gap : 0) + sizes.title : 0
      if (y > 0 && y + lead + h > height) {
        columns.push([{ section, entry: null, suite: !first, y: 0 }])
        y = sizes.title
      } else if (first) {
        y += y > 0 ? sizes.gap : 0
        columns[columns.length - 1].push({ section, entry: null, suite: false, y })
        y += sizes.title
      }
      columns[columns.length - 1].push({ section, entry, suite: false, y })
      y += h
      used = Math.max(used, y)
    })
  })
  return { columns, used }
}

/** Marges et tailles de la page, en points. */
export interface PageSizes extends ColumnSizes {
  pad: number
  header: number
  gutter: number
  column: number
}

export interface PageLayout {
  columns: Placed[][]
  /** Gauche de chaque colonne, et haut de la légende. */
  xs: number[]
  top: number
  mapScale: number
  width: number
  height: number
}

const MAP_SCALES = [1, 1.15, 1.3, 1.5]
/** La légende ne passe sous la carte que si le texte y gagne nettement. */
const UNDER_GAIN = 1.18

/** Grossissement du texte une fois l'image posée sur une feuille A4, en long ou en large. */
const readability = (w: number, h: number) => Math.max(Math.min(297 / w, 210 / h), Math.min(210 / w, 297 / h))

/**
 * Place la carte et sa légende : à côté, en colonnes de plus en plus longues, ou dessous quand elle est longue.
 * De toutes ces pages, celle où le texte se lit le mieux, avec une préférence pour la légende à côté.
 */
export function layoutPage(map: { w: number; h: number }, heights: readonly (readonly number[])[], s: PageSizes): PageLayout {
  const { pad, header, gutter, column } = s
  if (!heights.some((list) => list.length)) {
    return { columns: [], xs: [], top: header, mapScale: 1, width: map.w + pad * 2, height: header + map.h + pad }
  }
  const beside: PageLayout[] = []
  const shortest = Math.max(map.h, 560)
  for (let tall = shortest; ; tall += 12) {
    const { columns, used } = packColumns(heights, tall, s)
    const mapScale = Math.max(1, Math.min(MAP_SCALES[MAP_SCALES.length - 1], tall / map.h))
    const x = pad + map.w * mapScale + gutter
    beside.push({
      columns,
      xs: columns.map((_, c) => x + c * (column + gutter)),
      top: header,
      mapScale,
      width: x + columns.length * (column + gutter) - gutter + pad,
      height: header + Math.max(map.h * mapScale, used) + pad,
    })
    if (columns.length <= 1 || tall > shortest * 3) break
  }

  const below: PageLayout[] = []
  for (const mapScale of MAP_SCALES) {
    const inner = map.w * mapScale
    const count = Math.floor((inner + gutter) / (column + gutter))
    if (count < 2) continue
    let packed = packColumns(heights, 0, s)
    for (let tall = 40; packed.columns.length > count; tall += 8) packed = packColumns(heights, tall, s)
    // Les colonnes se répartissent sur la largeur de la carte
    const step = packed.columns.length > 1 ? Math.min((inner - column) / (count - 1), column * 1.6) : 0
    below.push({
      columns: packed.columns,
      xs: packed.columns.map((_, c) => pad + c * step),
      top: header + map.h * mapScale + gutter,
      mapScale,
      width: inner + pad * 2,
      height: header + map.h * mapScale + gutter + packed.used + pad,
    })
  }

  const best = (list: PageLayout[]) => list.reduce((a, b) => (readability(b.width, b.height) > readability(a.width, a.height) ? b : a))
  const side = best(beside)
  if (!below.length) return side
  const under = best(below)
  return readability(under.width, under.height) > readability(side.width, side.height) * UNDER_GAIN ? under : side
}

/** Passe à la ligne entre deux morceaux, jamais au milieu ; `width` d'un morceau donnée par `measure`. */
export function wrapItems<T>(items: readonly T[], max: number, measure: (item: T) => number, space: number): T[][] {
  const lines: T[][] = []
  let line: T[] = []
  let x = 0
  for (const item of items) {
    const w = measure(item)
    if (line.length && x + space + w > max) {
      lines.push(line)
      line = []
      x = 0
    }
    x += (line.length ? space : 0) + w
    line.push(item)
  }
  if (line.length) lines.push(line)
  return lines
}

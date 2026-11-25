import { describe, expect, it } from 'vitest'
import { exportLegend, layoutPage, packColumns, wrapItems, zoneTokens, type LegendOptions } from './exportLegend'
import { DEFAULT_FILTERS, buildMapModel, type ColorMode, type Filters } from './mapModel'
import { DEFAULT_STRUCTURES } from './structures'
import type { ARecruter, Affectation, Commercial, Couverture, MapData, Structure } from './types'
import { PARIS_ARR_CODES, ZONES } from './zones'

const person = (id: string, manager2: string | null = null): Commercial => ({
  id, nom: `Commercial ${id}`, statut: 'VRP', manager1: 'Nord', manager2, couleur: '#1a428a', actif: true, structures: ['MD', 'SP'], secteur: null, ordre: 0,
})
let n = 0
const aff = (commercial_id: string, zone_code: string, couverture: Couverture = 'propre', structure: Structure = 'MD'): Affectation => ({ id: `a${++n}`, commercial_id, structure, zone_code, couverture })
const row = (zone_code: string, priorite: ARecruter['priorite'], secteur: string | null = null): ARecruter => ({ structure: 'MD', zone_code, priorite, secteur })
const data = (affectations: Affectation[], a_recruter: ARecruter[] = [], settings?: MapData['settings']): MapData => ({
  admin: false, chiffres: false, manager: null, structures: DEFAULT_STRUCTURES, commerciaux: [person('A', 'Sud'), person('B', 'Sud'), person('C')], managers: [], affectations, objectifs: [], a_recruter, updated_at: null, settings,
})
const FRANCE = new Set(ZONES.filter((z) => z.type !== 'arrondissement').map((z) => z.code))
const legend = (d: MapData, mode: ColorMode, options: Partial<LegendOptions> = {}, filters: Filters = DEFAULT_FILTERS) =>
  exportLegend(buildMapModel(d, 'MD', filters, mode), { shown: FRANCE, sharedMode: 'rayures', highlighted: new Set(), withZones: false, ...options })
const text = (zones: ReturnType<typeof zoneTokens> = []) => zones.map((token) => token.map((s) => s.text).join('')).join(', ')
const refs = (...list: [string, Couverture | null][]) => list.map(([code, couverture]) => ({ code, couverture }))

describe('départements dans la légende', () => {
  it('porte la lettre de la couverture, rien en propre', () => {
    const tokens = zoneTokens(refs(['22', 'propre'], ['2A', 'gestion'], ['35', 'partiel'], ['54', 'gestion_partiel'], ['78', null]))
    expect(text(tokens)).toBe('22, 2AG, 35P, 54GP, 78')
    expect(tokens[1]).toEqual([{ text: '2A' }, { text: 'G', strong: true }])
  })

  it('regroupe les arrondissements qui se suivent, à couverture égale', () => {
    const arr = (from: number, to: number, c: Couverture) => refs(...Array.from({ length: to - from + 1 }, (_, i): [string, Couverture] => [`75-${from + i}`, c]))
    expect(text(zoneTokens(arr(1, 20, 'propre')))).toBe('75-1 à 75-20')
    expect(text(zoneTokens([...arr(1, 4, 'partiel'), ...arr(5, 6, 'propre'), ...refs(['92', 'propre'], ['93', 'propre'], ['94', 'propre'])]))).toBe('75-1P à 75-4P, 75-5, 75-6, 92, 93, 94')
    expect(text(zoneTokens(refs(['75', 'gestion'])))).toBe('75G')
  })
})

describe('légende de l\'export', () => {
  const full = data([aff('A', '22'), aff('A', '29', 'partiel'), aff('B', '29', 'gestion'), aff('C', '35')], [row('16', null, 'Ouest'), row('17', null, 'Ouest'), row('45', 1, 'Centre'), row('33', 3)])

  it('a un titre pour chaque partie, et explique les motifs présents seulement', () => {
    const sections = legend(full, 'commercial')
    expect(sections.map((s) => s.title)).toEqual(['Lecture de la carte', 'Commerciaux', 'À recruter'])
    expect(sections[0].entries.map((e) => e.label)).toEqual(['Propre', 'Partiel', 'Gestion', 'Zone partagée', 'À recruter, priorité 1', 'À recruter, priorité 3', 'À recruter, sans priorité', 'Groupe à recruter'])
    expect(sections[1].entries.map((e) => [e.label, e.count, e.zones])).toEqual([['Commercial A', '2 zones', undefined], ['Commercial B', '1 zone', undefined], ['Commercial C', '1 zone', undefined]])
    expect(sections[2].entries.map((e) => [e.label, e.swatch])).toEqual([
      ['Centre', { kind: 'recruter', color: '#c4320a', outline: '#c4320a' }],
      ['Ouest', { kind: 'recruter', color: null, outline: '#4b5869' }],
      ['Priorité 3', { kind: 'recruter', color: '#2f8fb3', outline: null }],
    ])
  })

  it('liste les départements sur demande, avec les lettres dans la lecture', () => {
    const [key, people, recruit] = legend(full, 'commercial', { withZones: true })
    expect(key.entries.slice(0, 3).map((e) => e.label)).toEqual(['Propre', 'Partiel (P)', 'Gestion (G)'])
    expect(people.entries.map((e) => text(e.zones))).toEqual(['22, 29P', '29G', '35'])
    expect(recruit.entries.map((e) => text(e.zones))).toEqual(['45', '16, 17', '33'])
  })

  it('en vue Manager, le département prend la couverture la plus forte de l\'équipe', () => {
    const both = legend(full, 'manager2', { withZones: true })
    expect(both.map((s) => s.title)).toContain('Manager 2')
    const team = both.find((s) => s.title === 'Manager 2')!.entries.find((e) => e.label === 'Sud')!
    expect(text(team.zones)).toBe('22, 29P')
    // A et B sont de la même équipe : la zone n'est plus partagée
    expect(both[0].entries.map((e) => e.label)).not.toContain('Zone partagée')
    const only2 = { default_shared_mode: 'rayures' as const, manager1_actif: false, manager2_actif: true }
    expect(legend({ ...full, settings: only2 }, 'manager2').map((s) => s.title)).toContain('Managers')
  })

  it('ne parle que des zones de l\'image', () => {
    const paris = data([aff('A', '22'), aff('B', '75'), aff('C', '75-7', 'partiel')])
    const shown = new Set(PARIS_ARR_CODES)
    const sections = legend(paris, 'commercial', { shown, withZones: true })
    expect(sections.find((s) => s.title === 'Commerciaux')!.entries.map((e) => [e.label, text(e.zones)])).toEqual([['Commercial B', '75'], ['Commercial C', '75-7P']])
    // Les arrondissements sont tous pris : rien à recruter sur cette image
    expect(sections.map((s) => s.title)).toEqual(['Lecture de la carte', 'Commerciaux'])
    // Sur la France, Paris est un seul département
    expect(legend(paris, 'commercial').find((s) => s.title === 'Commerciaux')!.entries).toHaveLength(3)
  })

  it('suit la mise en évidence, et ne dit pas « à recruter » quand un filtre cache des personnes', () => {
    expect(legend(full, 'commercial', { highlighted: new Set(['A']) }).map((s) => [s.title, s.entries.length])).toEqual([['Lecture de la carte', 8], ['Commerciaux', 1]])
    const filtered = legend(full, 'commercial', {}, { ...DEFAULT_FILTERS, commerciaux: ['C'] })
    expect(filtered.map((s) => [s.title, s.entries.map((e) => e.label)])).toEqual([['Lecture de la carte', ['Propre']], ['Commerciaux', ['Commercial C']]])
  })

  it('en Couverture, compte et liste les zones de chaque niveau', () => {
    const [section, ...rest] = legend(full, 'couverture', { withZones: true })
    expect(rest).toEqual([])
    expect(section.title).toBe('Niveau de couverture')
    const of = (label: string) => section.entries.find((e) => e.label === label)!
    expect(text(of('Couverte').zones)).toBe('22, 35')
    expect([of('Faible').count, text(of('Faible').zones)]).toEqual(['1 zone', '29'])
    expect(of('Non couverte').count).toBe('99 zones')
  })
})

describe('mise en colonnes', () => {
  const sizes = { title: 30, gap: 20 }

  it('met un titre, de l\'air, et passe à la colonne suivante', () => {
    const { columns, used } = packColumns([[20, 20], [20]], 200, sizes)
    expect(columns).toEqual([[
      { section: 0, entry: null, suite: false, y: 0 },
      { section: 0, entry: 0, suite: false, y: 30 },
      { section: 0, entry: 1, suite: false, y: 50 },
      { section: 1, entry: null, suite: false, y: 90 },
      { section: 1, entry: 0, suite: false, y: 120 },
    ]])
    expect(used).toBe(140)
  })

  it('ne laisse jamais un titre seul en bas, et le répète quand la section continue', () => {
    const { columns } = packColumns([[20, 20, 20], [20]], 70, sizes)
    expect(columns.map((c) => c.map((p) => [p.section, p.entry, p.suite]))).toEqual([
      [[0, null, false], [0, 0, false], [0, 1, false]],
      [[0, null, true], [0, 2, false]],
      [[1, null, false], [1, 0, false]],
    ])
    for (const c of columns) expect(c[c.length - 1].entry).not.toBeNull()
  })

  it('une entrée plus haute que la colonne y reste entière', () => {
    expect(packColumns([[500]], 100, sizes)).toMatchObject({ used: 530, columns: [[{ entry: null }, { entry: 0 }]] })
    expect(packColumns([], 100, sizes)).toEqual({ columns: [[]], used: 0 })
  })

  it('passe à la ligne entre deux morceaux', () => {
    expect(wrapItems(['aaaa', 'bb', 'cc', 'dddddddddddd'], 10, (s) => s.length, 1)).toEqual([['aaaa', 'bb', 'cc'], ['dddddddddddd']])
    expect(wrapItems([], 10, () => 1, 1)).toEqual([])
  })
})

describe('mise en page', () => {
  const sizes = { title: 36, gap: 22, pad: 24, header: 78, gutter: 30, column: 270 }
  const map = { w: 1250, h: 690 }
  const people = (n: number) => [Array.from({ length: 6 }, () => 24), Array.from({ length: n }, () => 43)]
  const bottom = (p: ReturnType<typeof layoutPage>) => p.top + Math.max(...p.columns.flat().map((r) => r.y))

  it('met une courte légende à côté, sans agrandir la carte', () => {
    const page = layoutPage(map, people(5), sizes)
    expect(page).toMatchObject({ mapScale: 1, top: 78, xs: [24 + 1250 + 30] })
    expect(page.width).toBe(24 + 1250 + 30 + 270 + 24)
    expect(page.height).toBe(78 + 690 + 24)
  })

  it('n\'ouvre pas une colonne pour une ligne : la carte grandit un peu', () => {
    const page = layoutPage(map, people(11), sizes)
    expect(page.columns).toHaveLength(1)
    expect(page.mapScale).toBeGreaterThan(1)
    expect(page.mapScale).toBeLessThan(1.1)
  })

  it('met une longue légende sous la carte, en colonnes', () => {
    const page = layoutPage(map, people(72), sizes)
    expect(page.top).toBe(78 + map.h * page.mapScale + 30)
    expect(page.columns.length).toBeGreaterThanOrEqual(4)
    expect(page.xs[page.xs.length - 1] + 270).toBeLessThanOrEqual(page.width - 24)
  })

  it('ne laisse pas de grand vide, et garde tout dans l\'image', () => {
    for (const n of [1, 5, 10, 20, 27, 40, 72, 120]) {
      const page = layoutPage(map, people(n), sizes)
      expect(page.columns.flat().filter((r) => r.entry !== null)).toHaveLength(6 + n)
      expect(bottom(page)).toBeLessThan(page.height)
      const beside = page.top === 78
      const used = map.w * map.h * page.mapScale ** 2 + page.columns.reduce((sum, c) => sum + (c[c.length - 1].y + 43) * 270, 0)
      expect(used / (page.width * page.height), `${n} lignes, ${beside ? 'à côté' : 'dessous'}`).toBeGreaterThan(0.6)
    }
  })

  it('reste lisible sur téléphone, et sans légende', () => {
    const phone = layoutPage({ w: 390, h: 520 }, people(20), sizes)
    expect(Math.max(...phone.xs) + 270).toBeLessThanOrEqual(phone.width - 24)
    expect(layoutPage(map, [], sizes)).toMatchObject({ columns: [], width: 1298, height: 792 })
  })
})

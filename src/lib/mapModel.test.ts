import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTERS, HEAT_BUCKETS, buildMapModel, heatBucketOf } from './mapModel'
import { agree, plural } from './text'
import { DEFAULT_STRUCTURES } from './structures'
import type { Affectation, Commercial, Couverture, MapData, Structure } from './types'

const commercial = (id: string, structures: Structure[] = ['MD']): Commercial => ({
  id,
  nom: `Commercial ${id}`,
  statut: 'VRP',
  manager1: 'Paul',
  manager2: null,
  couleur: '#1a428a',
  actif: true,
  structures,
  secteur: null,
  ordre: 0,
})

let n = 0
const aff = (commercial_id: string, zone_code: string, couverture: Couverture = 'propre', structure: Structure = 'MD'): Affectation => ({
  id: `a${++n}`,
  commercial_id,
  structure,
  zone_code,
  couverture,
})

const data = (affectations: Affectation[], commerciaux = ['A', 'B', 'C'].map((id) => commercial(id, ['MD', 'SP']))): MapData => ({
  admin: false,
  structures: DEFAULT_STRUCTURES,
  commerciaux,
  managers: [],
  affectations,
  objectifs: [],
  updated_at: null,
})

describe('carte de chaleur de la couverture', () => {
  it('additionne les commerciaux distincts selon leur couverture', () => {
    const m = buildMapModel(
      data([aff('A', '22'), aff('B', '22', 'partiel'), aff('C', '29', 'gestion'), aff('A', '22', 'gestion', 'SP')]),
      'ALL',
      DEFAULT_FILTERS,
      'couverture',
    )
    // A compte une fois (sa couverture la plus forte : propre), B en partiel
    expect(m.coverageOf('22')).toMatchObject({ score: 1.5, people: 2, bucket: { label: 'Couverte' } })
    expect(m.coverageOf('29')).toMatchObject({ score: 0.25, bucket: { label: 'Faible' } })
    expect(m.coverageOf('35')).toMatchObject({ score: 0, people: 0, bucket: { label: 'Non couverte' } })
  })

  it('applique l\'onglet de structure', () => {
    const m = buildMapModel(data([aff('A', '22'), aff('B', '22', 'propre', 'SP')]), 'SP', DEFAULT_FILTERS, 'couverture')
    expect(m.coverageOf('22').score).toBe(1)
  })

  it('« 75 » couvre chaque arrondissement, et le département 75 vaut la moyenne de ses arrondissements', () => {
    const m = buildMapModel(data([aff('A', '75'), aff('B', '75-7')]), 'ALL', DEFAULT_FILTERS, 'couverture')
    expect(m.coverageOf('75-7').score).toBe(2)
    expect(m.coverageOf('75-8').score).toBe(1)
    expect(m.coverageOf('75').score).toBeCloseTo(21 / 20)
  })

  it('range les scores dans les bons niveaux', () => {
    expect([0, 0.25, 0.75, 1, 1.5, 2, 2.5, 3, 7].map((s) => heatBucketOf(s).label)).toEqual([
      'Non couverte', 'Faible', 'Faible', 'Couverte', 'Couverte', 'Renforcée', 'Renforcée', 'Forte', 'Forte',
    ])
  })

  it('légende : un niveau par ligne, comptes sur les 102 départements, DROM et Monaco', () => {
    const m = buildMapModel(data([aff('A', '22'), aff('B', '22'), aff('C', '22'), aff('A', '971')]), 'ALL', DEFAULT_FILTERS, 'couverture')
    expect(m.legend.map((l) => l.key)).toEqual(HEAT_BUCKETS.map((b) => b.key))
    expect(m.legend.reduce((sum, l) => sum + l.zoneCount, 0)).toBe(102)
    expect(m.legend.find((l) => l.label === 'Forte')!.zoneCount).toBe(1)
    expect(m.legend.find((l) => l.label === 'Couverte')!.zoneCount).toBe(1)
  })

  it('un clic sur un niveau isole ses zones', () => {
    const m = buildMapModel(data([aff('A', '22')]), 'ALL', DEFAULT_FILTERS, 'couverture')
    const only = new Set(['cov:2'])
    expect(m.styleOf('22', only).fillOpacity).toBe(1)
    expect(m.styleOf('29', only).fillOpacity).toBeLessThan(0.5)
  })
})

describe('zones partagées et gestion', () => {
  it('une part par commercial pour les camemberts, avec l\'opacité de sa couverture', () => {
    const m = buildMapModel(data([aff('A', '22'), aff('B', '22', 'partiel')]), 'ALL', DEFAULT_FILTERS, 'commercial')
    const st = m.styleOf('22', new Set())
    expect(st.slices).toHaveLength(2)
    expect(st.pattern?.kind).toBe('stripes')
    expect(st.slices!.map((s) => s.opacity)).toEqual([0.88, 0.5])
  })

  it('une zone seule n\'a pas de parts ; la gestion seule est une trame de points', () => {
    const m = buildMapModel(data([aff('A', '22'), aff('B', '29', 'gestion')]), 'ALL', DEFAULT_FILTERS, 'commercial')
    expect(m.styleOf('22', new Set()).slices).toBeNull()
    expect(m.styleOf('29', new Set()).pattern?.kind).toBe('dots')
  })
})

describe('accords', () => {
  it('singulier pour 0 et 1, pluriel au-delà', () => {
    expect(plural(0, 'zone')).toBe('0 zone')
    expect(plural(1, 'commercial', 'commerciaux')).toBe('1 commercial')
    expect(plural(3, 'commercial', 'commerciaux')).toBe('3 commerciaux')
    expect(plural(2, 'commercial enregistré', 'commerciaux enregistrés')).toBe('2 commerciaux enregistrés')
    expect(agree(1, 'ajout')).toBe('ajout')
    expect(agree(4, 'suppression')).toBe('suppressions')
  })
})

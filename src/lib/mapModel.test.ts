import { isTooLight } from './colors'
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

describe('zones partagées, partiels et gestion', () => {
  const style = (affs: Affectation[], code: string) => buildMapModel(data(affs), 'ALL', DEFAULT_FILTERS, 'commercial').styleOf(code, new Set())
  const kinds = (affs: Affectation[], code: string) => style(affs, code).slices?.map((s) => s.kind)

  it('propre seul : couleur pleine, pas de parts', () => {
    const st = style([aff('A', '22')], '22')
    expect(st.slices).toBeNull()
    expect(st.pattern).toBeNull()
    expect(st.fillOpacity).toBe(0.88)
  })

  it('partiel seul : rayé avec du blanc, dans sa couleur pleine', () => {
    const st = style([aff('A', '22', 'partiel')], '22')
    expect(st.pattern?.kind).toBe('stripes')
    expect(st.slices!.map((s) => [s.kind, s.opacity])).toEqual([['plein', 0.88], ['blanc', 1]])
    expect(st.slices![1].color).toBe('#ffffff')
  })

  it('partiel avec un autre commercial : ils se complètent, pas de blanc', () => {
    expect(kinds([aff('A', '22'), aff('B', '22', 'partiel')], '22')).toEqual(['plein', 'plein'])
    expect(kinds([aff('A', '22', 'partiel'), aff('B', '22', 'partiel')], '22')).toEqual(['plein', 'plein'])
  })

  it('gestion seule : trame de points ; partagée : sa part en points', () => {
    expect(style([aff('A', '29', 'gestion')], '29').pattern?.kind).toBe('dots')
    expect(kinds([aff('A', '29', 'gestion'), aff('B', '29')], '29')).toEqual(['points', 'plein'])
  })

  it('gestion-partiel : traits pointillés avec du blanc, seul ; sans blanc, partagé', () => {
    expect(kinds([aff('A', '56', 'gestion_partiel')], '56')).toEqual(['tirets', 'blanc'])
    expect(kinds([aff('A', '56', 'gestion_partiel'), aff('B', '56')], '56')).toEqual(['tirets', 'plein'])
  })

  it('le principal d\'une zone partagée est la couverture la plus forte : propre, partiel, gestion, gestion-partiel', () => {
    const slices = style([aff('A', '35', 'gestion_partiel'), aff('B', '35', 'gestion'), aff('C', '35', 'partiel')], '35').slices!
    expect(slices.map((s) => s.kind)).toEqual(['tirets', 'points', 'plein'])
    expect([...slices].sort((a, b) => b.rank - a.rank)[0].kind).toBe('plein')
  })

  it('un commercial à la fois en gestion et en gestion-partiel sur une zone garde la gestion', () => {
    // 75 en gestion-partiel et 75-7 en gestion : sur le 7e, la gestion l'emporte
    expect(style([aff('A', '75', 'gestion_partiel'), aff('A', '75-7', 'gestion')], '75-7').pattern?.kind).toBe('dots')
    expect(kinds([aff('A', '75', 'gestion_partiel')], '75-8')).toEqual(['tirets', 'blanc'])
  })

  it('carte de chaleur : le gestion-partiel compte ⅛', () => {
    const m = buildMapModel(data([aff('A', '22', 'gestion_partiel'), aff('B', '22', 'gestion')]), 'ALL', DEFAULT_FILTERS, 'couverture')
    expect(m.coverageOf('22').score).toBe(0.375)
  })
})

describe('couleurs réservées', () => {
  it('le blanc et les couleurs presque blanches sont refusées, pas les teintes claires de la palette', () => {
    expect(['#ffffff', '#fafafa', '#f2f4f7', '#fff8e1'].map(isTooLight)).toEqual([true, true, true, true])
    // Jaunes vifs (dont une couleur réelle) et teintes claires de la palette : acceptés
    expect(['#f5f20b', '#ffff00', '#a3e635', '#95d4e9', '#fbbf24', '#e6194b'].map(isTooLight)).toEqual([false, false, false, false, false, false])
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

import { describe, expect, it } from 'vitest'
import { availableYears, defaultYear, perfBucketOf, perfText, sumPerf } from './performance'
import type { Objectif } from './types'

const o = (commercial_id: string, structure: 'MD' | 'SP', annee: number, ca: number | null, objectif: number | null): Objectif => ({
  commercial_id,
  structure,
  annee,
  ca,
  objectif,
})

const data = [
  o('A', 'MD', 2026, 80000, 100000),
  o('A', 'SP', 2026, 20000, 50000),
  o('B', 'MD', 2026, 150000, 120000),
  o('B', 'MD', 2025, 90000, 100000),
  o('C', 'MD', 2026, 5000, null),
]

describe('CA et objectifs', () => {
  it('additionne par commercial, structure et année', () => {
    expect(sumPerf(data, ['A'], 2026, ['MD', 'SP'])).toEqual({ ca: 100000, objectif: 150000, pct: 100000 / 150000, hasData: true })
    expect(sumPerf(data, ['A'], 2026, ['MD']).pct).toBe(0.8)
    expect(sumPerf(data, ['A', 'B'], 2026, ['MD'])).toMatchObject({ ca: 230000, objectif: 220000 })
    expect(sumPerf(data, ['B'], 2025, ['MD']).pct).toBe(0.9)
  })

  it('sans objectif : pas de taux, mais le CA compte', () => {
    expect(sumPerf(data, ['C'], 2026, ['MD'])).toEqual({ ca: 5000, objectif: 0, pct: null, hasData: true })
    expect(sumPerf(data, ['Z'], 2026, ['MD']).hasData).toBe(false)
  })

  it('range les taux dans les niveaux de la vue Performance', () => {
    expect([null, 0, 0.49, 0.5, 0.8, 0.99, 1, 1.19, 1.2, 3].map((p) => perfBucketOf(p).label)).toEqual([
      'Sans objectif', 'Moins de 50 %', 'Moins de 50 %', '50 à 80 %', '80 à 100 %', '80 à 100 %',
      '100 à 120 %', '100 à 120 %', '120 % et plus', '120 % et plus',
    ])
  })

  it('années : la plus récente avec des chiffres, et l\'année en cours toujours proposée', () => {
    expect(availableYears(data, 2027)).toEqual([2027, 2026, 2025])
    expect(defaultYear(data, 2027)).toBe(2026)
    expect(defaultYear(data, 2026)).toBe(2026)
    expect(defaultYear([], 2026)).toBe(2026)
  })

  it('texte court', () => {
    const sp = '\u202f'
    expect(perfText(sumPerf(data, ['A'], 2026, ['MD']))).toBe(`80${sp}k€ / 100${sp}k€ · 80${sp}%`)
    expect(perfText(sumPerf(data, ['A', 'B'], 2026, ['MD', 'SP']))).toBe(`250${sp}k€ / 270${sp}k€ · 93${sp}%`)
    expect(perfText(sumPerf(data, ['C'], 2026, ['MD']))).toMatch(/sans objectif/)
    expect(perfText(sumPerf(data, ['Z'], 2026, ['MD']))).toBe('aucun chiffre')
  })
})

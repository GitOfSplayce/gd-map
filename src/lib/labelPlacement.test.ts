import { describe, expect, it } from 'vitest'
import { MAX_TAKEN, bestSpot, countIn, lineBreaks, placeName, rasterOf, summed } from './labelPlacement'

/** Image d'après des lignes : « # » plein, « . » vide. */
const bits = (rows: string[]) => rows.join('').split('').map((c) => c === '#')
const rect = (w: number, h: number, x0: number, y0: number, x1: number, y1: number) => Array.from({ length: w * h }, (_, i) => i % w >= x0 && i % w < x1 && Math.floor(i / w) >= y0 && Math.floor(i / w) < y1)
const none = (w: number, h: number) => Array.from({ length: w * h }, () => false)

describe('place du nom d\'un groupe', () => {
  it('compte les points d\'un rectangle, même quand il dépasse', () => {
    const t = summed(bits(['##.', '.##', '...']), 3, 3)
    expect(countIn(t, 3, 3, 0, 0, 3, 3)).toBe(4)
    expect(countIn(t, 3, 3, 1, 0, 2, 2)).toBe(2)
    expect(countIn(t, 3, 3, -5, -5, 1, 1)).toBe(1)
    expect(countIn(t, 3, 3, 2, 2, 9, 9)).toBe(0)
  })

  it('tient dans le groupe, au centre', () => {
    const r = rasterOf(rect(100, 100, 20, 30, 80, 70), none(100, 100), 100, 100, 1)
    const spot = bestSpot(r, 30, 10)!
    expect(spot.inside).toBe(1)
    expect(Math.abs(spot.x - 50)).toBeLessThan(4)
    expect(Math.abs(spot.y - 50)).toBeLessThan(4)
  })

  it('évite les numéros', () => {
    const r = rasterOf(rect(100, 100, 10, 10, 90, 90), rect(100, 100, 35, 42, 65, 58), 100, 100, 480)
    const spot = bestSpot(r, 30, 10)!
    const overlap = countIn(r.taken, 100, 100, spot.x - 15, spot.y - 5, spot.x + 15, spot.y + 5)
    expect(spot.inside).toBe(1)
    expect(overlap).toBeLessThan(30)
  })

  it('passe sur deux lignes dans un groupe étroit, et attend qu\'on zoome s\'il est trop petit', () => {
    expect(lineBreaks('Nouvelle Aquitaine')).toEqual([['Nouvelle Aquitaine'], ['Nouvelle', 'Aquitaine']])
    expect(lineBreaks('Centre Val de Loire')[1]).toEqual(['Centre Val', 'de Loire'])
    expect(lineBreaks('Est')).toEqual([['Est']])
    const narrow = rasterOf(rect(100, 100, 30, 10, 70, 90), none(100, 100), 100, 100, 1)
    expect(placeName(narrow, 'Nouvelle', [5], 1)?.lines).toEqual(['Nouvelle'])
    expect(placeName(narrow, 'Nouvelle Aquitaine', [6], 1)?.lines).toEqual(['Nouvelle', 'Aquitaine'])
    expect(placeName(narrow, 'Nouvelle Aquitaine', [14], 1)).toBeNull()
    expect(placeName(narrow, 'Nouvelle Aquitaine', [14, 6], 1)).toMatchObject({ font: 6 })
    const wide = rasterOf(rect(200, 60, 5, 5, 195, 55), none(200, 60), 200, 60, 1)
    expect(placeName(wide, 'Nouvelle Aquitaine', [10], 1)?.lines).toEqual(['Nouvelle Aquitaine'])
  })

  it('ne cache pas un numéro, même petit à côté du nom', () => {
    // Un grand nom, un petit numéro au milieu : le cacher ne pèse que quelques pour cent du nom
    const r = rasterOf(rect(90, 30, 0, 0, 90, 30), rect(90, 30, 41, 11, 49, 19), 90, 30, 64)
    expect(placeName(r, 'Centre', [20], 1)).toBeNull()
    const spot = placeName(r, 'Centre', [20, 9], 1)!
    expect(spot.font).toBe(9)
    expect(spot.taken).toBeLessThanOrEqual(MAX_TAKEN)
  })
})

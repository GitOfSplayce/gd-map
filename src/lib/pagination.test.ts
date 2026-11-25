import { describe, expect, it } from 'vitest'
import { pageList } from './pagination'

describe('pages à montrer', () => {
  it('la première, la dernière et celles autour, avec un saut quand il en manque plusieurs', () => {
    expect(pageList(1, 3)).toEqual([1, 2, 3])
    expect(pageList(1, 12)).toEqual([1, 2, null, 11, 12])
    expect(pageList(6, 12)).toEqual([1, 2, null, 5, 6, 7, null, 11, 12])
    expect(pageList(4, 12)).toEqual([1, 2, 3, 4, 5, null, 11, 12])
    // Un seul numéro manquant : il est montré
    expect(pageList(5, 12)).toEqual([1, 2, 3, 4, 5, 6, null, 11, 12])
    expect(pageList(1, 1)).toEqual([1])
  })
})

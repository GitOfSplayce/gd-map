import { describe, expect, it } from 'vitest'
import { coverageIn, isPainted, paintZone, selectionFromText, selectionToText, toggleGroup, toggleZone, type ZoneSelection } from './zoneEditing'
import { PARIS_ARR_CODES } from './zones'

const text = (t: string, ...steps: [string, 'propre' | 'partiel' | 'gestion'][]) =>
  selectionToText(steps.reduce((sel, [code, brush]) => toggleZone(sel, code, brush), selectionFromText(t)))

describe('assistant de saisie des zones', () => {
  it('ajoute, change la couverture, puis retire une zone', () => {
    expect(text('22', ['35', 'propre'])).toBe('22, 35')
    expect(text('22, 35', ['35', 'partiel'])).toBe('22, 35P')
    expect(text('22, 35P', ['35', 'partiel'])).toBe('22')
  })

  it('écrit au format Excel, trié', () => {
    expect(text('', ['2B', 'gestion'], ['09', 'propre'], ['971', 'propre'], ['98', 'partiel'])).toBe('09, 2BG, 971, 98P')
  })

  it('« 75 » entier : cliquer un arrondissement détaille Paris', () => {
    const t = text('75', ['75-7', 'propre'])
    expect(t.split(', ')).toHaveLength(19)
    expect(t).not.toContain('75-7,')
    expect(t.startsWith('75-1, 75-2')).toBe(true)
  })

  it('les 20 arrondissements de même couverture redeviennent « 75 »', () => {
    const all = PARIS_ARR_CODES.join(', ')
    expect(selectionToText(selectionFromText(all))).toBe('75')
    expect(selectionToText(selectionFromText(all.replace('75-7', '75-7P')))).toContain('75-7P')
  })

  it('cliquer « 75 » remplace le détail par arrondissement', () => {
    expect(text('75-7, 75-8P', ['75', 'propre'])).toBe('75')
    expect(text('75', ['75', 'propre'])).toBe('')
  })

  it('un arrondissement hérite de la couverture de « 75 »', () => {
    expect(coverageIn(selectionFromText('75P'), '75-12')).toBe('partiel')
  })

  it('ajoute ou retire un groupe entier', () => {
    const bretagne = ['22', '29', '35', '56']
    const once = toggleGroup(selectionFromText('22'), bretagne, 'propre')
    expect(selectionToText(once)).toBe('22, 29, 35, 56')
    expect(selectionToText(toggleGroup(once, bretagne, 'propre'))).toBe('')
  })
})

describe('trait de pinceau', () => {
  const stroke = (t: string, brush: 'propre' | 'partiel', ...codes: string[]) => {
    const start = selectionFromText(t)
    const removing = isPainted(start, codes[0], brush)
    return selectionToText(codes.reduce<ZoneSelection>((sel, code) => paintZone(sel, code, brush, removing), start))
  }

  it('pose la couverture sur tout le trait, sans retirer ce qui l\'a déjà', () => {
    expect(stroke('22, 35P', 'propre', '29', '22', '35')).toBe('22, 29, 35')
    expect(stroke('', 'partiel', '13', '83', '13')).toBe('13P, 83P')
  })

  it('commencé sur une zone déjà peinte ainsi, retire celles-là seulement', () => {
    expect(stroke('22, 29, 35P', 'propre', '22', '35', '29', '56')).toBe('35P')
  })

  it('tout Paris se peint d\'un bloc, un arrondissement se détaille', () => {
    expect(stroke('', 'propre', '75')).toBe('75')
    expect(stroke('75', 'propre', '75')).toBe('')
    expect(selectionFromText(stroke('75', 'propre', '75-7')).has('75-7')).toBe(false)
    expect(stroke('75-1', 'propre', '75')).toBe('75')
  })
})

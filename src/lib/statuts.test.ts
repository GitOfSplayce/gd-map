import { describe, expect, it } from 'vitest'
import { statutChoices, statutNormalizer } from './statuts'

describe('statuts', () => {
  const existing = ['Agent Commercial', 'ATC Splayce', 'ATC Splayce', 'atc splayce', 'VRP', null, '']

  it('une seule entrée par statut dans le sélecteur', () => {
    expect(statutChoices(existing)).toEqual(['Agent commercial', 'ATC', 'ATC Splayce', 'VRP'])
  })

  it('ramène une saisie à l\'écriture retenue', () => {
    const norm = statutNormalizer(existing)
    expect(norm('  AGENT   commercial ')).toBe('Agent commercial')
    expect(norm('Atc splayce')).toBe('ATC Splayce')
    expect(norm('vrp')).toBe('VRP')
    expect(norm('Apporteur d\'affaires')).toBe('Apporteur d\'affaires')
    expect(norm('  ')).toBeNull()
    expect(norm(null)).toBeNull()
  })

  it('à égalité, garde l\'écriture accentuée', () => {
    expect(statutNormalizer(['Delegue', 'Délégué'])('DELEGUE')).toBe('Délégué')
  })
})

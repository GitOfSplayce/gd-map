import { describe, expect, it } from 'vitest'
import { statutChoices, statutNormalizer } from './statuts'

describe('statuts', () => {
  const existing = ['A recruter', 'A recruter', 'Agent Commercial', 'ATC Splayce', 'ATC Splayce', 'atc splayce', 'VRP', null, '']

  it('une seule entrée par statut dans le sélecteur', () => {
    expect(statutChoices(existing)).toEqual(['À recruter', 'Agent commercial', 'ATC', 'ATC Splayce', 'VRP'])
  })

  it('ramène une saisie ou un import à l\'écriture retenue', () => {
    const norm = statutNormalizer(existing)
    expect(norm('a recruter')).toBe('À recruter')
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

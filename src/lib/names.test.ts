import { describe, expect, it } from 'vitest'
import { formatName } from './names'

describe('écriture des noms', () => {
  it('met le nom de famille en majuscules, devant', () => {
    expect(formatName('Dupont Marie')).toBe('DUPONT Marie')
    expect(formatName('  dupont   Marie ')).toBe('DUPONT Marie')
    expect(formatName('Marie DUPONT')).toBe('DUPONT Marie')
    expect(formatName('Cloué Élise')).toBe('CLOUÉ Élise')
    expect(formatName('Dupont Marie-Hélène')).toBe('DUPONT Marie-Hélène')
    expect(formatName('Dupont Pierre Emmanuel')).toBe('DUPONT Pierre Emmanuel')
  })

  it('garde un nom déjà bien écrit', () => {
    for (const nom of ['DUPONT Marie', 'LE TILLEUL Sacha', 'CHARME - ORME Noa', 'FRÊNE-SAULE Alix', 'CHÊNE ROUVRE Lou Camille', 'DE LA TOUR Alix']) expect(formatName(nom)).toBe(nom)
  })

  it('suit la particule', () => {
    expect(formatName('De TREMBLE Sacha')).toBe('DE TREMBLE Sacha')
    expect(formatName('Sacha De TREMBLE')).toBe('DE TREMBLE Sacha')
    expect(formatName('De Tremble Sacha')).toBe('DE TREMBLE Sacha')
    expect(formatName('De la Tour Alix')).toBe('DE LA TOUR Alix')
    expect(formatName('Le Marie')).toBe('LE Marie')
  })

  it('ne devine pas quand rien ne l\'y aide', () => {
    expect(formatName('DUPONT MARIE')).toBe('DUPONT MARIE')
    expect(formatName('À recruter')).toBe('À recruter')
    expect(formatName('Dupont')).toBe('DUPONT')
    expect(formatName('')).toBe('')
    expect(formatName('   ')).toBe('')
  })
})

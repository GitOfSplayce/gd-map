import { describe, expect, it } from 'vitest'
import { DEFAULT_STRUCTURES, structureCodeIssue, structureCodes } from './structures'
import { headerKey } from './text'

const CODES = structureCodes(DEFAULT_STRUCTURES)

describe('headerKey', () => {
  it('ignore casse, accents, espaces et ponctuation', () => {
    expect(headerKey('Statut ')).toBe('statut')
    expect(headerKey('Région')).toBe('region')
  })
})

describe('code d\'une nouvelle structure', () => {
  it('2 à 6 majuscules ou chiffres, commençant par une lettre', () => {
    expect(structureCodeIssue('NV', CODES)).toBeNull()
    expect(structureCodeIssue('GD2026', CODES)).toBeNull()
    expect(structureCodeIssue('', CODES)).toMatch(/obligatoire/)
    expect(structureCodeIssue('N', CODES)).toMatch(/2 à 6/)
    expect(structureCodeIssue('2B', CODES)).toMatch(/2 à 6/)
    expect(structureCodeIssue('TROPLONG', CODES)).toMatch(/2 à 6/)
  })

  it('refuse un doublon et le nom de la vue globale', () => {
    expect(structureCodeIssue('MD', CODES)).toMatch(/déjà utilisé/)
    expect(structureCodeIssue('ALL', CODES)).toMatch(/réservé/)
  })
})

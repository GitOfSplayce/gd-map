import { describe, expect, it } from 'vitest'
import { emailIssue, formatPhone, normalizeEmail, phoneHref, phoneIssue } from './contacts'

describe('téléphone', () => {
  it('met les numéros français au format 06 12 34 56 78', () => {
    const f = '06 39 98 00 01'
    expect(['0639980001', '06.39.98.00.01', '06-39-98-00-01', '+33639980001', '+33 6 39 98 00 01', '+33 (0)6 39 98 00 01', '0033639980001'].map(formatPhone)).toEqual(
      Array(7).fill(f),
    )
    // Zéro perdu par Excel (cellule numérique)
    expect(formatPhone(639980001)).toBe(f)
    expect(formatPhone('01 23 45 67 89')).toBe('01 23 45 67 89')
  })

  it('laisse les numéros étrangers tels quels (espaces nettoyés)', () => {
    expect(formatPhone(' +377  93 15 00 00 ')).toBe('+377 93 15 00 00')
    expect(formatPhone('+32 2 123 45 67')).toBe('+32 2 123 45 67')
  })

  it('signale un numéro illisible, pas un champ vide', () => {
    expect(phoneIssue('')).toBeNull()
    expect(phoneIssue('06 39 98 00 01')).toBeNull()
    expect(phoneIssue('voir agence')).toMatch(/n'est pas un numéro/)
    expect(phoneIssue('12')).toMatch(/n'est pas un numéro/)
  })

  it("lien d'appel international", () => {
    expect(phoneHref('06 39 98 00 01')).toBe('tel:+33639980001')
    expect(phoneHref('+377 93 15 00 00')).toBe('tel:+37793150000')
  })
})

describe('e-mail', () => {
  it('en minuscules, sans espaces autour', () => {
    expect(normalizeEmail('  Agathe.Rolland@Example.com ')).toBe('agathe.rolland@example.com')
  })

  it('signale une adresse illisible, pas un champ vide', () => {
    expect(emailIssue('')).toBeNull()
    expect(emailIssue('a.b@example.com')).toBeNull()
    expect(emailIssue('pas-un-mail')).toMatch(/n'est pas une adresse/)
    expect(emailIssue('a@b')).toMatch(/n'est pas une adresse/)
  })
})

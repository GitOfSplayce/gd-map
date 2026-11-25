import { describe, expect, it } from 'vitest'
import { ORGANIZATIONS_CLAIM, PERSONAL_ACCESS_CLAIM, hasMapAccess, hasMapEntitlement } from './organizations.ts'

const membership = (entitlement: unknown) => ({ id: 'o1', slug: 'gdcom', name: 'GDCOM', parent_id: null, role: 'viewer', caps: [], entitlement })

describe('porte d’entrée du portail', () => {
  it('ouvre avec au moins une organisation qui a le droit d’usage gd-map', () => {
    expect(hasMapEntitlement([membership(null), membership({ vertical: null, tier: null, limits: {} })])).toBe(true)
  })

  it('reste fermée sans droit d’usage, claim absent ou abîmé', () => {
    expect(hasMapEntitlement([membership(null)])).toBe(false)
    expect(hasMapEntitlement(undefined)).toBe(false)
    expect(hasMapEntitlement('[]')).toBe(false)
    expect(hasMapEntitlement([{ entitlement: {} }])).toBe(false)
    // Un droit d'usage illisible vaut absent
    expect(hasMapEntitlement([membership('oui'), membership([])])).toBe(false)
  })

  it('ouvre aussi à la personne à qui le portail a donné l’accès, sans organisation (D-010)', () => {
    expect(hasMapAccess({ [PERSONAL_ACCESS_CLAIM]: true })).toBe(true)
    expect(hasMapAccess({ [PERSONAL_ACCESS_CLAIM]: true, [ORGANIZATIONS_CLAIM]: [membership(null)] })).toBe(true)
    expect(hasMapAccess({ [ORGANIZATIONS_CLAIM]: [membership({})] })).toBe(true)
    // Seul `true` compte : ni un texte, ni un nombre, ni l'absence
    for (const value of ['true', 1, {}, null, false, undefined]) expect(hasMapAccess({ [PERSONAL_ACCESS_CLAIM]: value })).toBe(false)
    expect(hasMapAccess({})).toBe(false)
  })
})

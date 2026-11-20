import { describe, expect, it } from 'vitest'
import { hasMapEntitlement } from './organizations.ts'

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
})

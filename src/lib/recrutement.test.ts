import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTERS, buildMapModel } from './mapModel'
import { activeManagers, fichesOf, managerLabel, manages, managersOf, teamManager } from './managers'
import { blockedZones, isARecruter, occupancyOf, sectorOf, vacancyIn, vacancyText, vacantZones } from './recrutement'
import { DEFAULT_STRUCTURES } from './structures'
import type { ARecruter, Affectation, Commercial, Couverture, MapData, Structure } from './types'

const person = (id: string, fields: Partial<Commercial> = {}): Commercial => ({
  id, nom: `Commercial ${id}`, statut: 'VRP', manager1: null, manager2: null, couleur: '#1a428a', actif: true, structures: ['MD', 'SP'], secteur: null, ordre: 0, ...fields,
})
let n = 0
const aff = (commercial_id: string, zone_code: string, structure: Structure = 'MD', couverture: Couverture = 'propre'): Affectation => ({ id: `a${++n}`, commercial_id, structure, zone_code, couverture })
const row = (structure: Structure, zone_code: string, priorite: ARecruter['priorite'], secteur: string | null = null): ARecruter => ({ structure, zone_code, priorite, secteur })
const map = (commerciaux: Commercial[], affectations: Affectation[], a_recruter: ARecruter[] = [], settings?: MapData['settings']): MapData => ({
  admin: false, chiffres: false, manager: { nom: 'Sud', structures: ['MD'] }, structures: DEFAULT_STRUCTURES, commerciaux, managers: [], affectations, objectifs: [], a_recruter, updated_at: null, settings,
})

describe('managers actifs', () => {
  const only2 = { default_shared_mode: 'rayures' as const, manager1_actif: false, manager2_actif: true }

  it('suivent les réglages ; seul, il s\'appelle « Manager »', () => {
    expect(activeManagers()).toEqual(['manager1', 'manager2'])
    expect(activeManagers(only2)).toEqual(['manager2'])
    expect(managerLabel('manager2', ['manager2'])).toBe('Manager')
    expect(managerLabel('manager2', ['manager1', 'manager2'])).toBe('Manager 2')
  })

  it('un manager désactivé ne donne plus de droits', () => {
    const c = person('A', { manager1: 'Sud', manager2: 'Nord' })
    expect(manages('Sud', c, activeManagers(), new Map())).toBe(true)
    expect(manages('Sud', c, activeManagers(only2), new Map())).toBe(false)
    expect(managersOf({ manager1: 'Sud', manager2: 'Sud' }, activeManagers())).toEqual(['Sud'])
  })
})

describe('fiche d\'un manager (D-013)', () => {
  const manon = person('E', { nom: 'PERRIN Manon', manager2: 'Direction' })
  const fiches = fichesOf([{ nom: 'Manon', commercial_id: 'E' }, { nom: 'Direction', commercial_id: null }])

  it('est à elle et à son manager, et compte dans sa propre équipe', () => {
    expect(manages('Manon', manon, ['manager2'], fiches)).toBe(true)
    expect(manages('Direction', manon, ['manager2'], fiches)).toBe(true)
    expect(manages('Sud', manon, ['manager2'], fiches)).toBe(false)
    expect(teamManager(manon, 'manager2', fiches)).toBe('Manon')
    expect(teamManager(person('Z', { manager2: 'Direction' }), 'manager2', fiches)).toBe('Direction')
  })

  it('prend la couleur de son équipe en vue Manager, et ses départements bloquent les autres', () => {
    const data = { ...map([manon, person('Z', { manager2: 'Direction' })], [aff('E', '35'), aff('Z', '22')]), managers: [{ nom: 'Manon', couleur: '#112233', commercial_id: 'E' }, { nom: 'Direction', couleur: '#445566' }] }
    const m = buildMapModel(data, 'MD', DEFAULT_FILTERS, 'manager2')
    expect(m.legend.map((l) => [l.label, l.zoneCount])).toEqual([['Direction', 1], ['Manon', 1]])
    expect(m.styleOf('35', new Set()).fill).toBe('#112233')
    const only = buildMapModel(data, 'MD', { ...DEFAULT_FILTERS, managerField: 'manager2', managers: ['Manon'] }, 'commercial')
    expect(only.legend.map((l) => l.label)).toEqual(['PERRIN Manon'])
    expect(blockedZones(data, person('Z', { manager2: 'Sud' }), 'MD', 'Sud', ['manager2']).get('35')).toBe('PERRIN Manon (manager)')
    expect(blockedZones(data, data.commerciaux[1], 'MD', 'Manon', ['manager2']).has('35')).toBe(false)
  })
})

describe('départements vides', () => {
  const data = map([person('A'), person('B', { actif: false })], [aff('A', '35'), aff('B', '22'), aff('A', '75-7'), aff('A', '44', 'SP', 'partiel')])
  const occ = occupancyOf(data)

  it('un commercial actif occupe, quel que soit le type ; un inactif non', () => {
    expect(vacancyIn('35', 'MD', occ, [])).toBeNull()
    expect(vacancyIn('44', 'SP', occ, [])).toBeNull()
    expect(vacancyIn('22', 'MD', occ, [])).toMatchObject({ structure: 'MD', priorite: null })
    expect(vacancyIn('35', 'SP', occ, [])).not.toBeNull()
  })

  it('prend la plus forte priorité et les secteurs ; Paris par arrondissement', () => {
    const rows = [row('MD', '75-1', 2, 'Centre'), row('MD', '75-2', 1), row('MD', '75-7', 3), row('SP', '75-3', 1)]
    const paris = vacancyIn('75', 'MD', occ, rows)!
    expect(paris).toMatchObject({ priorite: 1, secteurs: ['Centre'] })
    expect(paris.arrondissements).toHaveLength(19)
    expect(vacancyIn('75-7', 'MD', occ, rows)).toBeNull()
    // « 75 » entier vaut pour chaque arrondissement
    expect(vacancyIn('75-5', 'SP', occ, [row('SP', '75', 2)])).toMatchObject({ priorite: 2, arrondissements: null })
    expect(vacancyText({ structure: 'MD', priorite: 1, secteurs: ['Centre'], arrondissements: null })).toBe('Priorité 1 · groupe Centre')
    expect(vacancyText({ structure: 'MD', priorite: null, secteurs: [], arrondissements: null })).toBe('sans priorité')
  })

  it('liste les zones vides : Paris entier, ou ses arrondissements vides', () => {
    const md = vacantZones('MD', occ)
    expect(md).not.toContain('35')
    expect(md).not.toContain('75')
    expect(md.filter((c) => c.startsWith('75-'))).toHaveLength(19)
    const sp = vacantZones('SP', occ)
    expect(sp).toContain('75')
    expect(sp.some((c) => c.startsWith('75-'))).toBe(false)
    expect(sp).not.toContain('44')
  })
})

describe('départements d\'un autre manager', () => {
  const me = person('A', { manager2: 'Sud' })
  const data = map(
    [me, person('B', { manager2: 'Sud' }), person('C', { manager1: 'Sud', manager2: 'Nord' }), person('D')],
    [aff('A', '13'), aff('B', '83'), aff('C', '59'), aff('C', '13'), aff('C', '75-7'), aff('D', '66'), aff('C', '06', 'SP')],
  )

  it('sont bloqués, sauf ceux de son équipe, les siens et les autres structures', () => {
    const blocked = blockedZones(data, me, 'MD', 'Sud', ['manager2'])
    expect([...blocked.keys()].sort()).toEqual(['59', '66', '75', '75-7'])
    expect(blocked.get('59')).toBe('Commercial C (Nord)')
    expect(blocked.get('66')).toBe('Commercial D')
    expect(blockedZones(data, me, 'SP', 'Sud', ['manager2']).has('06')).toBe(true)
  })

  it('Manager 1 actif : le commercial partagé est aussi de son équipe', () => {
    expect([...blockedZones(data, me, 'MD', 'Sud', ['manager1', 'manager2']).keys()]).toEqual(['66'])
  })
})

describe('anciennes fiches « À recruter »', () => {
  it('se reconnaissent par le nom ou le statut, et laissent leur secteur', () => {
    expect(isARecruter({ nom: 'À recruter – Secteur Est', statut: null })).toBe(true)
    expect(isARecruter({ nom: 'Poste', statut: 'A RECRUTER' })).toBe(true)
    expect(isARecruter({ nom: 'Recruteur Paul', statut: 'VRP' })).toBe(false)
    expect(sectorOf({ nom: 'À recruter – Secteur Est', secteur: null })).toBe('Secteur Est')
    expect(sectorOf({ nom: 'A RECRUTER', secteur: 'Ouest' })).toBe('Ouest')
    expect(sectorOf({ nom: 'A recruter', secteur: null })).toBeNull()
  })
})

describe('carte : départements à recruter', () => {
  const rows = [row('MD', '18', 1, 'Centre'), row('MD', '36', null, 'Centre'), row('MD', '40', 3), row('SP', '35', 1)]
  const data = map([person('A')], [aff('A', '35')], rows)
  const model = (tab: string, filters = DEFAULT_FILTERS, mode: 'commercial' | 'couverture' = 'commercial') => buildMapModel(data, tab, filters, mode)
  const none = new Set<string>()

  it('se hachurent à la couleur de leur priorité ; sans priorité, ils restent gris, groupe ou pas', () => {
    const m = model('MD')
    expect(m.styleOf('18', none).pattern).toMatchObject({ kind: 'hatch', color: '#c4320a' })
    expect(m.styleOf('36', none)).toMatchObject({ pattern: null, fill: m.styleOf('22', none).fill })
    expect(m.styleOf('22', none).pattern).toBeNull()
  })

  it('légende : un poste par secteur, puis par priorité ; un clic isole ses départements', () => {
    const legend = model('MD').legend.filter((l) => l.group)
    expect(legend.map((l) => [l.shortLabel, l.zoneCount, l.detail])).toEqual([['Centre', 2, 'Priorité 1'], ['Priorité 3', 1, 'sans groupe']])
    const m = model('MD')
    const hit = new Set([legend[0].key])
    expect(m.styleOf('18', hit).strokeWidth).toBeGreaterThan(1)
    expect(m.styleOf('40', hit).fillOpacity).toBeLessThan(0.5)
  })

  it('groupes : leurs départements, leur nom et leur couleur, pour le contour', () => {
    expect(model('MD').groups).toEqual([{ key: 'r:MD|Centre', label: 'Centre', color: '#c4320a', codes: ['18', '36'] }])
    expect(model('ALL').groups[0].label).toBe('Centre (MD)')
    expect(model('SP').groups).toEqual([])
  })

  it('vue globale : occupé dès qu\'une structure y est ; le détail dit ce qui manque', () => {
    const m = model('ALL')
    expect(m.styleOf('35', none).pattern).toBeNull()
    expect(m.vacanciesOf('35').find((v) => v.structure === 'SP')).toMatchObject({ priorite: 1 })
    expect(model('SP').styleOf('35', none).pattern).toMatchObject({ kind: 'hatch', color: '#c4320a' })
    expect(m.legend.find((l) => l.group)?.shortLabel).toBe('Centre (MD)')
  })

  it('un filtre sur des personnes, « masquer », ou une autre vue ne les montre pas', () => {
    expect(model('MD', { ...DEFAULT_FILTERS, commerciaux: ['A'] }).styleOf('18', none).pattern).toBeNull()
    expect(model('MD', { ...DEFAULT_FILTERS, hideARecruter: true }).legend.some((l) => l.group)).toBe(false)
    expect(model('MD', DEFAULT_FILTERS, 'couverture').styleOf('18', none).pattern).toBeNull()
  })
})

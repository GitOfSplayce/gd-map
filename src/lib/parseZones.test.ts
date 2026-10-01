import { describe, expect, it } from 'vitest'
import { formatZoneList, parseZoneList } from './parseZones'

const codes = (input: unknown) => parseZoneList(input).zones.map((z) => z.code + ':' + z.couverture[0])

describe('parseZoneList – cas réels du fichier V3', () => {
  it('liste simple', () => {
    expect(codes('22, 29, 35, 44, 53, 56')).toEqual(['22:p', '29:p', '35:p', '44:p', '53:p', '56:p'])
  })

  it('suffixes G (gestion) et P (partiel)', () => {
    expect(codes('51, 08, 55, 52G, 10G')).toEqual(['51:p', '08:p', '55:p', '52:g', '10:g'])
    expect(codes('07G, 26G, 30P, 84')).toEqual(['07:g', '26:g', '30:p', '84:p'])
    expect(parseZoneList('33P, 46, 47').zones.map((z) => z.couverture)).toEqual(['partiel', 'propre', 'propre'])
    expect(codes('02, 60, 76G, 80')).toEqual(['02:p', '60:p', '76:g', '80:p'])
  })

  it('arrondissements de Paris et départements de petite couronne', () => {
    expect(codes('75-1, 75-2, 75-3, 75-20, 93, 94')).toEqual(['75-1:p', '75-2:p', '75-3:p', '75-20:p', '93:p', '94:p'])
  })

  it('Corse et Monaco', () => {
    expect(codes('04, 05, 2A, 2B, 83, 84')).toEqual(['04:p', '05:p', '2A:p', '2B:p', '83:p', '84:p'])
    expect(codes('06, 98')).toEqual(['06:p', '98:p'])
    expect(codes('98, 06')).toEqual(['98:p', '06:p'])
  })

  it('75 seul = tout Paris', () => {
    expect(codes('75, 77, 91')).toEqual(['75:p', '77:p', '91:p'])
  })
})

describe('parseZoneList – règles de lecture', () => {
  it('accepte tous les séparateurs , . / ; et espace', () => {
    expect(codes('22;35/52.56 29,,  44')).toEqual(['22:p', '35:p', '52:p', '56:p', '29:p', '44:p'])
  })

  it('complète un code à un chiffre par un 0', () => {
    expect(codes('9, 1P, 7G')).toEqual(['09:p', '01:p', '07:g'])
    expect(parseZoneList('1P').zones[0].couverture).toBe('partiel')
  })

  it('20 et 2AB donnent 2A + 2B', () => {
    expect(codes('20')).toEqual(['2A:p', '2B:p'])
    expect(codes('2AB')).toEqual(['2A:p', '2B:p'])
    expect(parseZoneList('20G').zones.map((z) => z.couverture)).toEqual(['gestion', 'gestion'])
    expect(codes('2ap')).toEqual(['2A:p'])
    expect(parseZoneList('2AP').zones[0].couverture).toBe('partiel')
  })

  it('lit les arrondissements, y compris avec espaces, zéros ou code postal', () => {
    expect(codes('75-7')).toEqual(['75-7:p'])
    expect(codes('75 - 7P')).toEqual(['75-7:p'])
    expect(parseZoneList('75 - 7P').zones[0].couverture).toBe('partiel')
    expect(codes('75-07, 75008, 75116')).toEqual(['75-7:p', '75-8:p', '75-16:p'])
  })

  it('ignore ?', () => {
    const r = parseZoneList('?, 35?, ?')
    expect(r.zones.map((z) => z.code)).toEqual(['35'])
    expect(r.issues).toEqual([])
  })

  it('lit les DROM', () => {
    expect(codes('971, 972, 973, 974, 976')).toEqual(['971:p', '972:p', '973:p', '974:p', '976:p'])
  })

  it('signale les valeurs inconnues', () => {
    const r = parseZoneList('22, 96, 975, 75-21, 00, abc, 2C')
    expect(r.zones.map((z) => z.code)).toEqual(['22'])
    expect(r.issues.filter((i) => i.level === 'error').map((i) => i.raw)).toEqual(['96', '975', '75-21', '00', 'ABC', '2C'])
  })

  it('signale les doublons de couverture différente et garde le premier', () => {
    const r = parseZoneList('35P, 35, 22, 22')
    expect(r.zones).toEqual([
      { code: '35', couverture: 'partiel', raw: '35P' },
      { code: '22', couverture: 'propre', raw: '22' },
    ])
    expect(r.issues).toHaveLength(1)
    expect(r.issues[0].level).toBe('warning')
  })

  it('signale 75 + arrondissements comme redondant', () => {
    const r = parseZoneList('75, 75-7')
    expect(r.zones).toHaveLength(2)
    expect(r.issues[0].level).toBe('warning')
  })

  it('valeurs vides ou non textuelles', () => {
    expect(parseZoneList(null)).toEqual({ zones: [], issues: [] })
    expect(parseZoneList('')).toEqual({ zones: [], issues: [] })
    expect(codes(22)).toEqual(['22:p'])
  })
})

describe('formatZoneList', () => {
  it('trie et remet les suffixes', () => {
    expect(
      formatZoneList([
        { zone_code: '75-10', couverture: 'propre' },
        { zone_code: '2B', couverture: 'gestion' },
        { zone_code: '971', couverture: 'propre' },
        { zone_code: '75-7', couverture: 'partiel' },
        { zone_code: '09', couverture: 'propre' },
        { zone_code: '98', couverture: 'propre' },
        { zone_code: '75', couverture: 'propre' },
        { zone_code: '2A', couverture: 'propre' },
        { zone_code: '21', couverture: 'propre' },
      ]),
    ).toBe('09, 2A, 2BG, 21, 75, 75-7P, 75-10, 971, 98')
  })

  it('fait l\'aller-retour avec parseZoneList', () => {
    const input = '98, 22, 35P, 52G, 75-7, 2A, 971'
    const parsed = parseZoneList(input).zones.map((z) => ({ zone_code: z.code, couverture: z.couverture }))
    const formatted = formatZoneList(parsed)
    expect(formatted).toBe('2A, 22, 35P, 52G, 75-7, 971, 98')
    expect(parseZoneList(formatted).zones.map((z) => ({ zone_code: z.code, couverture: z.couverture }))).toEqual(
      [...parsed].sort((a, b) => formatted.indexOf(a.zone_code) - formatted.indexOf(b.zone_code)),
    )
  })
})

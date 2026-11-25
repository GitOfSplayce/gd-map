import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { demoData } from './demo'
import { buildExcel, columnName, sheetOf } from './excelSheets'
import { exportSheets, zoneRows } from './exportExcel'
import type { MapData } from './types'

const texts = (sheet: ReturnType<typeof exportSheets>[number]) => (sheet.data as ({ value?: unknown } | null)[][]).map((r) => r.map((c) => c?.value ?? null))
const headers = (sheet: ReturnType<typeof exportSheets>[number]) => texts(sheet)[3]

describe('export Excel', () => {
  const data = demoData()
  const [commerciaux, departements, chiffres, managers] = exportSheets(data, 2026, new Date('2026-11-25T10:00:00Z'))

  it('a quatre feuilles, avec titre, filtres et volets figés', () => {
    expect([commerciaux, departements, chiffres, managers].map((s) => s.sheet)).toEqual(['Commerciaux', 'Départements', 'CA et objectifs', 'Managers'])
    expect(commerciaux).toMatchObject({ stickyRowsCount: 4, stickyColumnsCount: 1, orientation: 'landscape' })
    expect(commerciaux.autoFilter).toMatch(/^A4:[A-Z]+\d+$/)
    expect(String(texts(commerciaux)[1][0])).toMatch(/25\/11\/2026/)
  })

  it('suit les managers actifs', () => {
    expect(headers(commerciaux)).toEqual(expect.arrayContaining(['Manager 1', 'Manager 2', 'Date 1', 'Date 2']))
    const only2: MapData = { ...data, settings: { ...data.settings!, manager1_actif: false } }
    const sheets = exportSheets(only2, 2026)
    for (const s of sheets.slice(0, 3)) {
      expect(headers(s)).toContain('Manager')
      expect(headers(s)).not.toContain('Manager 1')
    }
    expect(headers(sheets[0])).not.toContain('Date 1')
  })

  it('une ligne par département et commercial ; les vides sont à recruter, avec priorité et secteur', () => {
    const rows = zoneRows(data)
    expect(rows.find((r) => r.structure === 'MD' && r.code === '29')?.commercial?.nom).toBe('Agathe Rolland')
    expect(rows.find((r) => r.structure === 'MD' && r.code === '67')).toMatchObject({ commercial: null, priorite: 1, secteurs: 'Secteur Est' })
    expect(rows.find((r) => r.structure === 'BK' && r.code === '29')).toMatchObject({ commercial: null, priorite: null, secteurs: '' })
    // Aucun département n'est à la fois pourvu et à recruter
    const taken = new Set(rows.filter((r) => r.commercial).map((r) => r.structure + r.code))
    expect(rows.some((r) => !r.commercial && taken.has(r.structure + r.code))).toBe(false)
  })

  it('écrit un classeur lisible : filtres et mise à la page dans le bon ordre, montants en nombres, formules neutralisées', async () => {
    const blob = await buildExcel([
      ...exportSheets(data, 2026),
      sheetOf({ name: 'Piège : [1/2]', title: 'T', subtitle: 'S', columns: [{ header: 'A', width: 10, value: () => '=1+1' }, { header: 'B', width: 10, kind: 'euros', value: () => 1500 }], rows: [{}], total: ['Total', 1500] }),
    ])
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
    const xml = (name: string) => strFromU8(files[name])
    expect(xml('xl/workbook.xml')).toContain('Piège')
    for (let i = 1; i <= 5; i++) {
      const sheet = xml(`xl/worksheets/sheet${i}.xml`)
      const order = ['<sheetPr', '<sheetViews', '<cols', '<sheetData', '<autoFilter', '<mergeCells', '<pageSetup'].map((tag) => sheet.indexOf(tag))
      expect(order.every((at) => at > 0), `feuille ${i} : ${order.join(' ')}`).toBe(true)
      expect([...order].sort((a, b) => a - b)).toEqual(order)
      expect(sheet).toContain('fitToHeight="0"')
    }
    const trap = xml('xl/worksheets/sheet5.xml')
    expect(trap).not.toContain('<f>')
    expect(trap).toContain('<v>1500</v>')
  })

  it('nomme les colonnes comme Excel', () => {
    expect([0, 25, 26, 51, 52].map(columnName)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA'])
  })
})

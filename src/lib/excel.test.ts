import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildExportWorkbook, parseSheet, readWorkbook } from './excel'
import { headerKey } from './text'
import { planToMapData } from './demo'
import { planImport, rowAssignments } from './importDiff'
import { DEFAULT_STRUCTURES, structureCodeIssue, structureCodes } from './structures'
import type { Affectation, Commercial, Objectif } from './types'

const CODES = structureCodes(DEFAULT_STRUCTURES)

const SAMPLE = fileURLToPath(new URL('../../exemples/exemple-import.xlsx', import.meta.url))
const REAL = fileURLToPath(new URL('../../Classeur V3.xlsx', import.meta.url))

const load = (path: string) => {
  const buf = readFileSync(path)
  return readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}

const zonesOf = (row: { zones: Record<string, { code: string; couverture: string }[]> }, s: string) =>
  row.zones[s].map((z) => z.code + (z.couverture === 'partiel' ? 'P' : z.couverture === 'gestion' ? 'G' : ''))

describe('headerKey', () => {
  it('ignore casse, accents, espaces et ponctuation', () => {
    expect(headerKey('Statut ')).toBe('statut')
    expect(headerKey('Nb de jour / an')).toBe('nbdejouran')
    expect(headerKey('Région')).toBe('region')
    expect(headerKey(' DPT  MD')).toBe('dptmd')
  })
})

describe('import du fichier exemple', () => {
  const wb = load(SAMPLE)
  const res = parseSheet(wb, 'V3', CODES)

  it('trouve l\'en-tête en ligne 3 et toutes les colonnes', () => {
    expect(res.errors).toEqual([])
    expect(res.headerRow).toBe(3)
    expect(res.missing).toEqual([])
    expect(res.columns.statut).toBe('Statut')
  })

  it('ignore les lignes sans nom', () => {
    expect(res.rows).toHaveLength(19)
    expect(res.rows.map((r) => r.nom)).not.toContain('')
  })

  it('lit les champs d\'une ligne complète', () => {
    const capucine = res.rows.find((r) => r.nom === 'Capucine Delorme')!
    expect(capucine.rowNumber).toBe(6)
    expect(capucine.structures).toEqual(['MD', 'SP'])
    expect(capucine.statut).toBe('ATC Splayce')
    expect(capucine.jours_an).toBe(2)
    expect(capucine.manager1).toBe('Inès')
    expect(capucine.date_manager1).toBe('mi-Oct')
    expect(capucine.secteur).toBe('Secteur Alpes')
    expect(zonesOf(capucine, 'MD')).toEqual(['73', '74'])
    expect(zonesOf(capucine, 'SP')).toEqual(['01', '26', '38', '73', '74'])
    expect(capucine.objectifs).toEqual([
      { structure: 'MD', ca: 80000, objectif: 90000 },
      { structure: 'SP', ca: 40000, objectif: 50000 },
    ])
  })

  it('applique les règles de lecture des zones', () => {
    const byName = (n: string) => res.rows.find((r) => r.nom === n)!
    expect(zonesOf(byName('Basile Fournier'), 'MD')).toEqual(['57', '08', '55', '52G', '10G'])
    expect(zonesOf(byName('Gaspard Lenoir'), 'MD')).toEqual(['04', '05', '2A', '2B', '83', '13'])
    expect(zonesOf(byName('MOULIN Axel'), 'SP')).toEqual(['02', '59', '76G', '62'])
    const jade = byName('PRADEL Jade')
    expect(zonesOf(jade, 'BK')).toEqual(['13', '09', '2A', '2B'])
    expect(jade.zoneIssues.BK.map((i) => i.raw)).toEqual(['1000'])
  })

  it('formate les dates Excel', () => {
    expect(res.rows.find((r) => r.nom === 'NAUDIN Margaux')!.date_manager2).toBe('01/01/2027')
  })

  it('ajoute la structure quand des zones sont saisies sans X, avec un avertissement', () => {
    const jade = res.rows.find((r) => r.nom === 'PRADEL Jade')!
    expect(jade.structures).toEqual(['BK'])
    const lucas = res.rows.find((r) => r.nom === 'OGER Lucas')!
    expect(lucas.structures).toEqual(['MC', 'BK'])
    expect(lucas.warnings[0]).toMatch(/BK/)
  })

  it('signale un onglet absent', () => {
    expect(parseSheet(wb, 'V4', CODES).errors[0]).toMatch(/introuvable/)
    expect(parseSheet(wb, 'Notes', CODES).errors[0]).toMatch(/Nom/)
  })
})

describe('repérage des colonnes par le nom de l\'en-tête', () => {
  it('donne le même résultat quel que soit l\'ordre des colonnes', () => {
    const ws = XLSX.utils.aoa_to_sheet([
      [],
      [],
      ['DPT SP', 'Manager 2', 'nom', 'SP', 'statut', 'Manager 1', 'DPT MD', 'MD'],
      ['35P, 53', 'Bastien', 'Test Un', 'X', 'VRP', 'Noémie', '22', 'x'],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'V3')
    const res = parseSheet(wb, 'V3', CODES)
    expect(res.rows[0]).toMatchObject({ nom: 'Test Un', statut: 'VRP', manager1: 'Noémie', manager2: 'Bastien', structures: ['MD', 'SP'] })
    expect(zonesOf(res.rows[0], 'SP')).toEqual(['35P', '53'])
    expect(res.missing).toEqual(['DPT MC', 'DPT BK'])
  })
})

describe('aperçu des changements et export', () => {
  const rows = parseSheet(load(SAMPLE), 'V3', CODES).rows
  const empty = { structures: DEFAULT_STRUCTURES, commerciaux: [] as Commercial[], affectations: [] as Affectation[], objectifs: [] as Objectif[] }

  // Simule l'état de la base après un premier import
  const stateAfterImport = () => planToMapData(planImport(rows, empty, 'merge', 2026))

  it('premier import : tout est ajouté, avec des couleurs distinctes', () => {
    const plan = planImport(rows, empty, 'replace', 2026)
    expect(plan.counts).toEqual({ add: 19, update: 0, unchanged: 0, delete: 0 })
    expect(new Set(plan.payload.map((p) => p.couleur)).size).toBe(19)
  })

  it('réimport identique : aucun changement', () => {
    const plan = planImport(rows, stateAfterImport(), 'replace', 2026)
    expect(plan.counts).toEqual({ add: 0, update: 0, unchanged: 19, delete: 0 })
  })

  it('fusion vs remplacement', () => {
    const state = stateAfterImport()
    const edited = rows.slice(1).map((r) => (r.nom === 'Capucine Delorme' ? { ...r, statut: 'VRP', zones: { ...r.zones, MD: [...r.zones.MD, { code: '42', couverture: 'partiel' as const, raw: '42P' }] } } : r))
    const merge = planImport(edited, state, 'merge', 2026)
    expect(merge.counts).toEqual({ add: 0, update: 1, unchanged: 17, delete: 0 })
    const capucine = merge.items.find((i) => i.nom === 'Capucine Delorme')!
    expect(capucine.fields).toEqual([{ label: 'Statut', before: 'ATC Splayce', after: 'VRP' }])
    expect(capucine.zones).toEqual([{ structure: 'MD', added: ['42P'], removed: [], changed: [] }])

    const replace = planImport(edited, state, 'replace', 2026)
    expect(replace.counts.delete).toBe(1)
    expect(replace.deleteIds).toEqual(['demo-0'])
  })

  it('signale les noms en double dans le fichier', () => {
    const plan = planImport([...rows, { ...rows[0], rowNumber: 99, nom: 'agathe  ROLLAND' }], empty, 'merge', 2026)
    expect(plan.duplicates.map((d) => d.rowNumber)).toEqual([99])
  })

  it('export puis réimport : mêmes données', () => {
    const state = stateAfterImport()
    const wb = buildExportWorkbook(CODES, state.commerciaux, state.affectations, state.objectifs, 2026)
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const back = parseSheet(readWorkbook(buf), 'V3', CODES)
    expect(back.headerRow).toBe(3)
    expect(back.rows).toHaveLength(19)
    const plan = planImport(back.rows, state, 'replace', 2026)
    expect(plan.counts).toEqual({ add: 0, update: 0, unchanged: 19, delete: 0 })
    const norm = (r: (typeof rows)[number]) => rowAssignments(r).map((a) => `${a.structure}:${a.zone_code}:${a.couverture}`).sort()
    expect(back.rows.map(norm)).toEqual(rows.map(norm))
  })
})

describe('structure ajoutée dans l\'admin', () => {
  const sheet = (rows: unknown[][]) => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], [], ...rows]), 'V3')
    return wb
  }

  it('ses colonnes sont lues dès qu\'elle existe, et signalées tant qu\'elle n\'existe pas', () => {
    const wb = sheet([
      ['Nom', 'MD', 'DPT MD', 'NV', 'DPT NV', 'CA NV', 'Objectif NV'],
      ['Test Deux', 'X', '22', 'X', '13, 84P', '1 000', '2000'],
    ])
    const before = parseSheet(wb, 'V3', CODES)
    expect(before.unknownStructures).toEqual(['DPT NV'])
    expect(before.rows[0].structures).toEqual(['MD'])

    const after = parseSheet(wb, 'V3', [...CODES, 'NV'])
    expect(after.unknownStructures).toEqual([])
    expect(after.rows[0].structures).toEqual(['MD', 'NV'])
    expect(zonesOf(after.rows[0], 'NV')).toEqual(['13', '84P'])
    expect(after.rows[0].objectifs).toContainEqual({ structure: 'NV', ca: 1000, objectif: 2000 })
  })

  it('l\'export a une colonne de chaque sorte par structure, dans l\'ordre choisi', () => {
    const codes = ['SP', 'MD', 'NV']
    const c: Commercial = { id: 'x', nom: 'Test', statut: null, manager1: null, manager2: null, couleur: '#123456', actif: true, structures: ['NV'], secteur: null, ordre: 1 }
    const wb = buildExportWorkbook(codes, [c], [{ id: 'a', commercial_id: 'x', structure: 'NV', zone_code: '13', couverture: 'propre' }], [], 2026)
    const header = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.V3, { header: 1 })[2] as string[]
    expect(header.slice(0, 4)).toEqual(['Nom', 'SP', 'MD', 'NV'])
    expect(header.filter((h) => h.startsWith('DPT'))).toEqual(['DPT SP', 'DPT MD', 'DPT NV'])
    expect(header.filter((h) => h.startsWith('CA '))).toEqual(['CA SP', 'CA MD', 'CA NV'])
    const back = parseSheet(wb, 'V3', codes)
    expect(back.missing).toEqual([])
    expect(zonesOf(back.rows[0], 'NV')).toEqual(['13'])
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

  it('refuse un doublon et ce qui rendrait une colonne Excel ambiguë', () => {
    expect(structureCodeIssue('MD', CODES)).toMatch(/déjà utilisé/)
    expect(structureCodeIssue('NOM', CODES)).toMatch(/colonne du fichier/)
    expect(structureCodeIssue('STATUT', CODES)).toMatch(/colonne du fichier/)
    expect(structureCodeIssue('ALL', CODES)).toMatch(/colonne du fichier/)
    // « CAMD » : sa colonne « CAMD » se confondrait avec « CA MD »
    expect(structureCodeIssue('CAMD', CODES)).toMatch(/se confondraient avec celles de MD/)
    expect(structureCodeIssue('DPTSP', CODES)).toMatch(/se confondraient avec celles de SP/)
  })
})

describe.skipIf(!existsSync(REAL))('fichier réel Classeur V3.xlsx (local uniquement, non versionné)', () => {
  it('se lit sans erreur bloquante', () => {
    const res = parseSheet(load(REAL), 'V3', CODES)
    expect(res.errors).toEqual([])
    expect(res.unknownStructures).toEqual([])
    expect(res.headerRow).toBe(3)
    expect(res.rows.length).toBeGreaterThan(50)
    const unknown = res.rows.flatMap((r) => Object.values(r.zoneIssues).flat().filter((i) => i.level === 'error'))
    expect(unknown).toEqual([])
    // Aucun nom réel ici : ce fichier de test est versionné
    expect(res.rows.some((r) => r.zones.MD.some((z) => z.code.startsWith('75-')))).toBe(true)
  })
})

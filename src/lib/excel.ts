// Lecture et écriture du fichier Excel (onglet V3, en-têtes en ligne 3).
// Les colonnes sont repérées par le nom de l'en-tête, jamais par leur position.
import * as XLSX from 'xlsx'
import { formatZoneList, parseZoneList, type ParsedZone, type ZoneParseIssue } from './parseZones'
import { headerKey } from './text'
import { STRUCTURES, type Affectation, type Commercial, type Objectif, type Structure } from './types'

export const DEFAULT_SHEET = 'V3'
export const DEFAULT_HEADER_ROW = 3

type Field =
  | 'nom' | 'statut' | 'jours_an' | 'manager1' | 'date_manager1' | 'manager2' | 'date_manager2'
  | 'actions' | 'secteur' | 'couleur' | 'actif' | 'notes'
  | `x_${Structure}` | `dpt_${Structure}` | `ca_${Structure}` | `obj_${Structure}`

const ALIASES: Record<Field, string[]> = {
  nom: ['nom', 'nomducommercial', 'commercial'],
  statut: ['statut'],
  jours_an: ['nbdejouran', 'nbdejoursan', 'nbjoursan', 'joursan'],
  manager1: ['manager1'],
  date_manager1: ['date1'],
  manager2: ['manager2'],
  date_manager2: ['date2'],
  actions: ['actions', 'action'],
  secteur: ['region', 'secteur'],
  couleur: ['couleur'],
  actif: ['actif'],
  notes: ['notes', 'note'],
  ...(Object.fromEntries(
    STRUCTURES.flatMap((s) => {
      const k = s.toLowerCase()
      return [
        [`x_${s}`, [k]],
        [`dpt_${s}`, [`dpt${k}`, `dept${k}`, `departements${k}`, `zones${k}`]],
        [`ca_${s}`, [`ca${k}`]],
        [`obj_${s}`, [`objectif${k}`, `obj${k}`]],
      ]
    }),
  ) as Record<`x_${Structure}` | `dpt_${Structure}` | `ca_${Structure}` | `obj_${Structure}`, string[]>),
}

export interface ImportRow {
  /** Numéro de ligne dans Excel (1 = première ligne). */
  rowNumber: number
  nom: string
  structures: Structure[]
  statut: string | null
  jours_an: number | null
  manager1: string | null
  date_manager1: string | null
  manager2: string | null
  date_manager2: string | null
  actions: string | null
  secteur: string | null
  /** Présents seulement si la colonne existe dans le fichier. */
  couleur?: string
  actif?: boolean
  notes?: string | null
  zones: Record<Structure, ParsedZone[]>
  zoneIssues: Record<Structure, ZoneParseIssue[]>
  objectifs: { structure: Structure; ca: number | null; objectif: number | null }[]
  warnings: string[]
}

export interface SheetParseResult {
  rows: ImportRow[]
  headerRow: number
  columns: Partial<Record<Field, string>>
  missing: string[]
  errors: string[]
}

export function readWorkbook(data: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(data, { type: 'array', cellDates: true })
}

const pad = (n: number) => String(n).padStart(2, '0')
const formatDate = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return formatDate(v)
  const s = String(v).trim()
  return s === '' ? null : s
}

function number(v: unknown): number | null | 'invalid' {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : 'invalid'
  const s = String(v).replace(/[\s €]/g, '').replace(',', '.')
  if (s === '' || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : 'invalid'
}

const isChecked = (v: unknown) => {
  const s = text(v)
  return s !== null && !['0', '-', 'non', 'n', 'false'].includes(s.toLowerCase())
}

function findHeaderRow(matrix: unknown[][]): number {
  const limit = Math.min(matrix.length, 15)
  for (let i = 0; i < limit; i++) {
    if ((matrix[i] ?? []).some((c) => headerKey(c) === 'nom')) return i
  }
  return DEFAULT_HEADER_ROW - 1
}

export function parseSheet(wb: XLSX.WorkBook, sheetName: string): SheetParseResult {
  const ws = wb.Sheets[sheetName]
  if (!ws) return { rows: [], headerRow: 0, columns: {}, missing: [], errors: [`Onglet « ${sheetName} » introuvable`] }

  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true })
  const h = findHeaderRow(matrix)
  const headers = (matrix[h] ?? []).map(headerKey)

  // Première colonne dont l'en-tête correspond à un alias (par ordre de priorité des alias)
  const col: Partial<Record<Field, number>> = {}
  const columns: Partial<Record<Field, string>> = {}
  for (const [field, aliases] of Object.entries(ALIASES) as [Field, string[]][]) {
    for (const alias of aliases) {
      const idx = headers.indexOf(alias)
      if (idx >= 0) {
        col[field] = idx
        columns[field] = String(matrix[h][idx]).trim()
        break
      }
    }
  }

  const errors: string[] = []
  if (col.nom === undefined) {
    errors.push('Colonne « Nom » introuvable : vérifiez l\'onglet et la ligne d\'en-tête')
    return { rows: [], headerRow: h + range.s.r + 1, columns, missing: ['Nom'], errors }
  }

  const missing = [
    ...(['statut', 'manager1', 'manager2'] as const).filter((f) => col[f] === undefined).map((f) => ALIASES[f][0]),
    ...STRUCTURES.filter((s) => col[`dpt_${s}`] === undefined).map((s) => `DPT ${s}`),
  ]

  const get = (r: unknown[], f: Field) => (col[f] === undefined ? null : r[col[f]!])
  const rows: ImportRow[] = []

  matrix.slice(h + 1).forEach((r, i) => {
    const nom = text(get(r, 'nom'))
    if (!nom) return
    const warnings: string[] = []

    const zones = {} as ImportRow['zones']
    const zoneIssues = {} as ImportRow['zoneIssues']
    const structures: Structure[] = []
    const objectifs: ImportRow['objectifs'] = []

    for (const s of STRUCTURES) {
      const parsed = parseZoneList(get(r, `dpt_${s}`))
      zones[s] = parsed.zones
      zoneIssues[s] = parsed.issues
      const checked = isChecked(get(r, `x_${s}`))
      if (checked) structures.push(s)
      else if (parsed.zones.length) {
        structures.push(s)
        warnings.push(`Zones en ${s} sans « X » dans la colonne ${s} : la structure est ajoutée`)
      }

      const ca = number(get(r, `ca_${s}`))
      const objectif = number(get(r, `obj_${s}`))
      if (ca === 'invalid') warnings.push(`CA ${s} illisible : ignoré`)
      if (objectif === 'invalid') warnings.push(`Objectif ${s} illisible : ignoré`)
      const caN = ca === 'invalid' ? null : ca
      const objN = objectif === 'invalid' ? null : objectif
      if (caN !== null || objN !== null) objectifs.push({ structure: s, ca: caN, objectif: objN })
    }

    const jours = number(get(r, 'jours_an'))
    if (jours === 'invalid') warnings.push('« Nb de jour / an » illisible : ignoré')

    const row: ImportRow = {
      rowNumber: h + range.s.r + i + 2,
      nom,
      structures,
      statut: text(get(r, 'statut')),
      jours_an: jours === 'invalid' ? null : jours,
      manager1: text(get(r, 'manager1')),
      date_manager1: text(get(r, 'date_manager1')),
      manager2: text(get(r, 'manager2')),
      date_manager2: text(get(r, 'date_manager2')),
      actions: text(get(r, 'actions')),
      secteur: text(get(r, 'secteur')),
      zones,
      zoneIssues,
      objectifs,
      warnings,
    }

    if (col.couleur !== undefined) {
      const c = text(get(r, 'couleur'))
      if (c && /^#?[0-9a-f]{6}$/i.test(c)) row.couleur = (c.startsWith('#') ? c : '#' + c).toLowerCase()
      else if (c) warnings.push(`Couleur « ${c} » ignorée (format attendu : #RRGGBB)`)
    }
    if (col.actif !== undefined) {
      const a = text(get(r, 'actif'))
      if (a !== null) row.actif = !['non', 'n', '0', 'false', 'inactif'].includes(a.toLowerCase())
    }
    if (col.notes !== undefined) row.notes = text(get(r, 'notes'))

    rows.push(row)
  })

  return { rows, headerRow: h + range.s.r + 1, columns, missing, errors }
}

// ---------------------------------------------------------------------------
// Export

export const EXPORT_HEADERS = [
  'Nom', 'MD', 'SP', 'MC', 'BK', 'Statut', 'Nb de jour / an', 'Manager 1', 'Date 1', 'Manager 2', 'Date 2',
  'Actions', 'Région', 'DPT MD', 'DPT SP', 'DPT MC', 'DPT BK',
  ...STRUCTURES.flatMap((s) => [`CA ${s}`, `Objectif ${s}`]),
  'Couleur', 'Actif', 'Notes',
]

export function buildExportWorkbook(
  commerciaux: Commercial[],
  affectations: Affectation[],
  objectifs: Objectif[],
  annee: number,
): XLSX.WorkBook {
  const today = formatDate(new Date())
  const rows: unknown[][] = [
    [`Carte commerciale – export du ${today} (CA et objectifs : ${annee})`],
    [],
    EXPORT_HEADERS,
  ]

  for (const c of [...commerciaux].sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom, 'fr'))) {
    const own = affectations.filter((a) => a.commercial_id === c.id)
    const obj = (s: Structure) => objectifs.find((o) => o.commercial_id === c.id && o.structure === s && o.annee === annee)
    rows.push([
      c.nom,
      ...STRUCTURES.map((s) => (c.structures.includes(s) ? 'X' : '')),
      c.statut ?? '',
      c.jours_an ?? '',
      c.manager1 ?? '',
      c.date_manager1 ?? '',
      c.manager2 ?? '',
      c.date_manager2 ?? '',
      c.actions ?? '',
      c.secteur ?? '',
      ...STRUCTURES.map((s) => formatZoneList(own.filter((a) => a.structure === s))),
      ...STRUCTURES.flatMap((s) => [obj(s)?.ca ?? '', obj(s)?.objectif ?? '']),
      c.couleur,
      c.actif ? 'Oui' : 'Non',
      c.notes ?? '',
    ])
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = EXPORT_HEADERS.map((hdr) =>
    hdr === 'Nom' ? { wch: 30 } : hdr.startsWith('DPT') ? { wch: 34 } : hdr.length <= 2 ? { wch: 4 } : { wch: 14 },
  )
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: rows.length - 1, c: EXPORT_HEADERS.length - 1 } }) }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, DEFAULT_SHEET)
  return wb
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename, { compression: true })
}

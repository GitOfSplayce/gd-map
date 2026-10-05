// Lecture et écriture du fichier Excel (onglet V3, en-têtes en ligne 3).
// Les colonnes sont repérées par le nom de l'en-tête, jamais par leur position.
import * as XLSX from 'xlsx'
import { parseAmountInput } from './amounts'
import { emailIssue, formatPhone, normalizeEmail, phoneIssue } from './contacts'
import { formatZoneList, parseZoneList, type ParsedZone, type ZoneParseIssue } from './parseZones'
import { BASE_ALIASES, type BaseField } from './excelHeaders'
import { structureHeaderKeys } from './structures'
import { headerKey } from './text'
import type { Affectation, Commercial, Objectif, Structure } from './types'

export const DEFAULT_SHEET = 'V3'
export const DEFAULT_HEADER_ROW = 3

type Field = BaseField | `x_${Structure}` | `dpt_${Structure}` | `ca_${Structure}` | `obj_${Structure}`

/** En-têtes reconnus pour chaque champ, structures comprises (même ordre que structureHeaderKeys). */
function aliasesFor(structures: readonly Structure[]): Record<Field, string[]> {
  const out: Record<string, string[]> = { ...BASE_ALIASES }
  for (const s of structures) {
    const [x, dpt, dept, departements, zones, ca, objectif, obj] = structureHeaderKeys(s)
    out[`x_${s}`] = [x]
    out[`dpt_${s}`] = [dpt, dept, departements, zones]
    out[`ca_${s}`] = [ca]
    out[`obj_${s}`] = [objectif, obj]
  }
  return out as Record<Field, string[]>
}

/** « DPT XY » ou « Zones XY » pour une structure XY qui n'existe pas (encore) dans l'admin. */
function unknownStructureColumns(headers: string[], raw: unknown[], structures: readonly Structure[]): string[] {
  const known = new Set(structures.map((s) => s.toLowerCase()))
  const out: string[] = []
  headers.forEach((h, i) => {
    const m = /^(?:dpt|dept|departements|zones)([a-z][a-z0-9]{1,5})$/.exec(h)
    if (m && !known.has(m[1])) out.push(String(raw[i]).trim())
  })
  return out
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
  /** Coordonnées : présentes seulement si la colonne existe (un fichier sans ces colonnes ne les efface pas). */
  telephone?: string | null
  email?: string | null
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
  /** Colonnes de zones d'une structure inconnue, ignorées (« DPT XY »). */
  unknownStructures: string[]
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

/** CA et objectifs : nombre Excel, ou texte comme à la saisie (« 120k », « 1,2M », « 120 000 € »). */
function amount(v: unknown): number | null | 'invalid' {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 'invalid'
  const n = parseAmountInput(text(v))
  return Number.isNaN(n) ? 'invalid' : n
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

/** Lit l'onglet ; `structures` = codes des structures existantes (colonnes « MD », « DPT MD », « CA MD »…). */
export function parseSheet(wb: XLSX.WorkBook, sheetName: string, structures: readonly Structure[]): SheetParseResult {
  const ws = wb.Sheets[sheetName]
  if (!ws) {
    return { rows: [], headerRow: 0, columns: {}, missing: [], unknownStructures: [], errors: [`Onglet « ${sheetName} » introuvable`] }
  }
  const ALIASES = aliasesFor(structures)

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
    return { rows: [], headerRow: h + range.s.r + 1, columns, missing: ['Nom'], unknownStructures: [], errors }
  }

  const missing = [
    ...(['statut', 'manager1', 'manager2'] as const).filter((f) => col[f] === undefined).map((f) => ALIASES[f][0]),
    ...structures.filter((s) => col[`dpt_${s}`] === undefined).map((s) => `DPT ${s}`),
  ]
  const unknownStructures = unknownStructureColumns(headers, matrix[h] ?? [], structures)

  const get = (r: unknown[], f: Field) => (col[f] === undefined ? null : r[col[f]!])
  const rows: ImportRow[] = []

  matrix.slice(h + 1).forEach((r, i) => {
    const nom = text(get(r, 'nom'))
    if (!nom) return
    const warnings: string[] = []

    const zones = {} as ImportRow['zones']
    const zoneIssues = {} as ImportRow['zoneIssues']
    const rowStructures: Structure[] = []
    const objectifs: ImportRow['objectifs'] = []

    for (const s of structures) {
      const parsed = parseZoneList(get(r, `dpt_${s}`))
      zones[s] = parsed.zones
      zoneIssues[s] = parsed.issues
      const checked = isChecked(get(r, `x_${s}`))
      if (checked) rowStructures.push(s)
      else if (parsed.zones.length) {
        rowStructures.push(s)
        warnings.push(`Zones en ${s} sans « X » dans la colonne ${s} : la structure est ajoutée`)
      }

      const ca = amount(get(r, `ca_${s}`))
      const objectif = amount(get(r, `obj_${s}`))
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
      structures: rowStructures,
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
    if (col.telephone !== undefined) {
      const raw = text(get(r, 'telephone'))
      if (phoneIssue(raw)) warnings.push(`Téléphone « ${raw} » illisible : ignoré`)
      else row.telephone = formatPhone(raw) || null
    }
    if (col.email !== undefined) {
      const raw = text(get(r, 'email'))
      if (emailIssue(raw)) warnings.push(`E-mail « ${raw} » illisible : ignoré`)
      else row.email = normalizeEmail(raw) || null
    }

    rows.push(row)
  })

  return { rows, headerRow: h + range.s.r + 1, columns, missing, unknownStructures, errors }
}

// ---------------------------------------------------------------------------
// Export

/** En-têtes de l'export, dans l'ordre du fichier d'origine, avec une colonne de chaque sorte par structure. */
export const exportHeaders = (structures: readonly Structure[]) => [
  'Nom', ...structures, 'Statut', 'Nb de jour / an', 'Manager 1', 'Date 1', 'Manager 2', 'Date 2',
  'Actions', 'Région', ...structures.map((s) => `DPT ${s}`),
  ...structures.flatMap((s) => [`CA ${s}`, `Objectif ${s}`]),
  'Téléphone', 'E-mail', 'Couleur', 'Actif', 'Notes',
]

export function buildExportWorkbook(
  structures: readonly Structure[],
  commerciaux: Commercial[],
  affectations: Affectation[],
  objectifs: Objectif[],
  annee: number,
): XLSX.WorkBook {
  const today = formatDate(new Date())
  const headers = exportHeaders(structures)
  const rows: unknown[][] = [
    [`Carte commerciale – export du ${today} (CA et objectifs : ${annee})`],
    [],
    headers,
  ]

  for (const c of [...commerciaux].sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom, 'fr'))) {
    const own = affectations.filter((a) => a.commercial_id === c.id)
    const obj = (s: Structure) => objectifs.find((o) => o.commercial_id === c.id && o.structure === s && o.annee === annee)
    rows.push([
      c.nom,
      ...structures.map((s) => (c.structures.includes(s) ? 'X' : '')),
      c.statut ?? '',
      c.jours_an ?? '',
      c.manager1 ?? '',
      c.date_manager1 ?? '',
      c.manager2 ?? '',
      c.date_manager2 ?? '',
      c.actions ?? '',
      c.secteur ?? '',
      ...structures.map((s) => formatZoneList(own.filter((a) => a.structure === s))),
      ...structures.flatMap((s) => [obj(s)?.ca ?? '', obj(s)?.objectif ?? '']),
      c.telephone ?? '',
      c.email ?? '',
      c.couleur,
      c.actif ? 'Oui' : 'Non',
      c.notes ?? '',
    ])
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = headers.map((hdr) =>
    hdr === 'Nom' || hdr === 'E-mail'
      ? { wch: 30 }
      : hdr.startsWith('DPT')
        ? { wch: 34 }
        : structures.includes(hdr)
          ? { wch: Math.max(4, hdr.length + 1) }
          : { wch: hdr === 'Téléphone' ? 16 : 14 },
  )
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: rows.length - 1, c: headers.length - 1 } }) }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, DEFAULT_SHEET)
  return wb
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename, { compression: true })
}

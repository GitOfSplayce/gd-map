// Classeurs Excel mis en forme (titre, en-têtes aux couleurs de la charte, lignes alternées, volets figés,
// filtres, impression en paysage sur une page de large). La bibliothèque n'est chargée qu'à l'export.
import type { CellObject, Sheet, SheetData } from 'write-excel-file/universal'
import { shade } from './colors'
import { perfBucketOf } from './performance'

export type CellValue = string | number | null

export interface Column<T> {
  header: string
  /** Largeur, en caractères. */
  width: number
  value: (row: T) => CellValue
  kind?: 'text' | 'euros' | 'percent' | 'number'
  align?: 'left' | 'center' | 'right'
  wrap?: boolean
  bold?: boolean
  /** Couleur du texte (taux d'atteinte, priorité) ou du fond de la cellule. */
  color?: (row: T) => string | undefined
  fill?: (row: T) => string | undefined
}

export interface TableSheet<T> {
  name: string
  title: string
  subtitle: string
  columns: Column<T>[]
  rows: T[]
  /** Dernière ligne, en gras, hors des filtres. */
  total?: CellValue[]
  /** Colonnes figées à gauche. */
  frozenColumns?: number
}

const SAPHIR = '#1A428A'
const AZURIN = '#D9EFF7'
const ZEBRA = '#F4F8FB'
const BORDER = '#DCE6EF'
const TEXT = '#3C3C3B'
const MUTED = '#5D6A7C'

const FORMATS = { text: undefined, euros: '#,##0 "€"', percent: '0%', number: '#,##0.##' } as const

/** Première ligne de données : titre, sous-titre, ligne vide, en-têtes. */
const HEADER_ROW = 4

/** Couleur d'un taux d'atteinte, assez foncée pour se lire en texte sur fond blanc. */
export const pctTextColor = (pct: number | null) => (pct === null ? undefined : shade(perfBucketOf(pct).color, 0.35))

/** Nom de colonne Excel : 0 → A, 26 → AA. */
export const columnName = (i: number): string => (i >= 26 ? columnName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26))

/** Un nom d'onglet Excel : 31 caractères, sans []:*?/\ . */
const sheetName = (name: string) => name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31)

/** Un texte qui commence comme une formule reste un texte (saisie libre : noms, notes). */
const textCell = (value: string) => ({ value, type: String, format: '@' })

function cellOf<T>(column: Column<T>, value: CellValue, style: object): CellObject {
  const kind = column.kind ?? 'text'
  const base = {
    align: column.align ?? (kind === 'text' ? ('left' as const) : ('right' as const)),
    alignVertical: 'center' as const,
    ...(column.wrap && { wrap: true }),
    ...(FORMATS[kind] && { format: FORMATS[kind] }),
    ...style,
  }
  // Cellule vide : mise en forme gardée (fond, bordure), sans valeur
  if (value === null || value === '') return { ...base, value: null, format: undefined } as unknown as CellObject
  return (typeof value === 'number' ? { ...base, value, type: Number } : { ...base, ...textCell(value) }) as unknown as CellObject
}

/** Le contenu et les réglages d'une feuille, prêts pour l'écriture. */
export function sheetOf<T>(table: TableSheet<T>): Sheet<Blob> & { autoFilter: string } {
  const { columns, rows } = table
  const border = { borderColor: BORDER, borderStyle: 'thin' as const }
  // Hauteur fixe, sauf quand une colonne va à la ligne : Excel l'ajuste alors au texte
  const height = columns.some((c) => c.wrap) ? undefined : 19
  const pad = Array.from({ length: columns.length - 1 }, () => null)
  const data: SheetData = [
    [{ value: table.title, type: String, fontSize: 16, fontWeight: 'bold', textColor: SAPHIR, height: 28, alignVertical: 'center', columnSpan: columns.length }, ...pad],
    [{ value: table.subtitle, type: String, textColor: MUTED, fontStyle: 'italic', height: 18, alignVertical: 'center', columnSpan: columns.length }, ...pad],
    [],
    columns.map((c) => ({
      value: c.header,
      type: String,
      fontWeight: 'bold' as const,
      textColor: '#FFFFFF',
      backgroundColor: SAPHIR,
      align: c.align ?? (c.kind && c.kind !== 'text' ? ('right' as const) : ('left' as const)),
      alignVertical: 'center' as const,
      height: 24,
      wrap: true,
      borderColor: SAPHIR,
      borderStyle: 'thin' as const,
    })),
    ...rows.map((row, i) =>
      columns.map((c) => {
        const fill = c.fill?.(row) ?? (i % 2 ? ZEBRA : undefined)
        return cellOf(c, c.value(row), {
          ...border,
          ...(height && { height }),
          textColor: c.color?.(row) ?? TEXT,
          ...(c.bold && { fontWeight: 'bold' }),
          ...(fill && { backgroundColor: fill }),
        })
      }),
    ),
    ...(table.total
      ? [columns.map((c, i) => cellOf(c, table.total![i] ?? null, { ...border, fontWeight: 'bold', textColor: SAPHIR, backgroundColor: AZURIN, height: 22 }))]
      : []),
  ]
  return {
    data,
    sheet: sheetName(table.name),
    columns: columns.map((c) => ({ width: c.width })),
    stickyRowsCount: HEADER_ROW,
    ...(table.frozenColumns && { stickyColumnsCount: table.frozenColumns }),
    orientation: 'landscape',
    showGridLines: false,
    autoFilter: `A${HEADER_ROW}:${columnName(columns.length - 1)}${HEADER_ROW + Math.max(rows.length, 1)}`,
  }
}

/** Écrit le classeur. Les filtres et la mise à la page ne sont pas dans la bibliothèque : posés ici, dans le XML. */
export async function buildExcel(sheets: (Sheet<Blob> & { autoFilter?: string })[]): Promise<Blob> {
  const [{ default: writeExcelFile }, { insertElementMarkupAccordingToOrderOfSiblings, getOrderOfSiblings, findElement, prependMarkupInsideElement }] = await Promise.all([
    import('write-excel-file/universal'),
    import('write-excel-file/utility'),
  ])
  const SHEET = 'xl/worksheets/sheet{id}.xml'
  return writeExcelFile(sheets, {
    fontFamily: 'Calibri',
    fontSize: 11,
    features: [
      {
        files: {
          transform: {
            [SHEET]: {
              transform: (xml, options) => {
                const ref = (options as { autoFilter?: string }).autoFilter
                let out = xml
                if (ref) out = insertElementMarkupAccordingToOrderOfSiblings(out, `<autoFilter ref="${ref}"/>`, getOrderOfSiblings(SHEET, 'worksheet')!, 'worksheet')
                // Une page de large, autant de pages de haut qu'il faut
                if (!findElement(out, 'sheetPr')) {
                  out = prependMarkupInsideElement(out, findElement(out, 'worksheet')!, '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>')
                }
                return out
              },
              transformElementAttributes: (tagName, attributes) =>
                tagName === 'pageSetup' ? { ...attributes, paperSize: 9, fitToWidth: 1, fitToHeight: 0 } : attributes,
            },
          },
        },
      },
    ],
  }).toBlob()
}

/** Écrit le classeur et le propose en téléchargement. */
export async function downloadExcel(tables: (Sheet<Blob> & { autoFilter?: string })[], filename: string) {
  const url = URL.createObjectURL(await buildExcel(tables))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

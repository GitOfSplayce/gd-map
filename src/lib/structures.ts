// Structures du groupe (MD, SP…) : gérées dans l'admin, lues avec les données de la carte.
import { headerKey } from './text'

export interface StructureDef {
  /** Code court, en majuscules : onglet de la carte et colonnes Excel (« DPT MD », « CA MD »…). */
  code: string
  nom: string
  ordre: number
}

/** Structures d'origine : base de départ, mode démo et tests. */
export const DEFAULT_STRUCTURES: StructureDef[] = [
  { code: 'MD', nom: 'Maison Davoise', ordre: 1 },
  { code: 'SP', nom: 'Splayce', ordre: 2 },
  { code: 'MC', nom: 'MaucoCartex', ordre: 3 },
  { code: 'BK', nom: 'BK Event', ordre: 4 },
]

export const sortStructures = (list: StructureDef[]) =>
  [...list].sort((a, b) => a.ordre - b.ordre || a.code.localeCompare(b.code))

export const structureCodes = (list: StructureDef[]): string[] => sortStructures(list).map((s) => s.code)

/** Nom complet d'une structure (« Maison Davoise »), ou le code si elle est inconnue. */
export const structureName = (list: StructureDef[], code: string) => list.find((s) => s.code === code)?.nom ?? code

/** Codes rangés dans l'ordre des structures (les inconnus à la fin). */
export function inStructureOrder(codes: readonly string[], order: readonly string[]): string[] {
  const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length)
  return [...codes].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** Format d'un code : 2 à 6 lettres ou chiffres, commençant par une lettre (comme en base). */
export const STRUCTURE_CODE_PATTERN = /^[A-Z][A-Z0-9]{1,5}$/

/** En-têtes du fichier Excel qu'un code de structure ne doit pas imiter (colonne « MD », « DPT MD », « CA MD »…). */
const RESERVED_HEADERS = [
  'nom', 'nomducommercial', 'commercial', 'statut', 'nbdejouran', 'nbdejoursan', 'nbjoursan', 'joursan',
  'manager1', 'manager2', 'date1', 'date2', 'actions', 'action', 'region', 'secteur', 'couleur', 'actif',
  'notes', 'note', 'all',
]

/** En-têtes Excel propres à une structure (sans espaces ni accents, comme headerKey). */
export function structureHeaderKeys(code: string): string[] {
  const k = code.toLowerCase()
  return [k, `dpt${k}`, `dept${k}`, `departements${k}`, `zones${k}`, `ca${k}`, `objectif${k}`, `obj${k}`]
}

/**
 * Problème d'un code de structure proposé, ou null s'il convient.
 * Vérifie le format et qu'aucune colonne du fichier Excel ne deviendrait ambiguë.
 */
export function structureCodeIssue(code: string, others: readonly string[]): string | null {
  if (!code) return 'Le code est obligatoire.'
  if (!STRUCTURE_CODE_PATTERN.test(code)) return 'Le code fait 2 à 6 caractères (lettres majuscules et chiffres), en commençant par une lettre.'
  if (others.includes(code)) return `Le code ${code} est déjà utilisé.`
  const mine = structureHeaderKeys(code)
  if (mine.some((k) => RESERVED_HEADERS.includes(k))) return `« ${code} » est déjà le nom d'une colonne du fichier Excel.`
  const taken = new Set(others.flatMap(structureHeaderKeys))
  const clash = mine.find((k) => taken.has(k))
  if (clash) {
    const owner = others.find((o) => structureHeaderKeys(o).includes(clash))
    return `Les colonnes Excel de ${code} se confondraient avec celles de ${owner}.`
  }
  return null
}

/** Normalise une saisie de code (« md » → « MD »). */
export const normalizeStructureCode = (s: string) => headerKey(s).toUpperCase()

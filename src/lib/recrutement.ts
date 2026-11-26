// Départements à recruter (D-011, D-016) : un département vide d'une structure est à recruter. Une ligne de
// `a_recruter` y ajoute une priorité (1 à 3) ou un groupe (colonne `secteur`) : les départements d'un même
// poste. Elle peut aussi marquer un département où quelqu'un est déjà. Paris se compte par arrondissement.
import { fichesOf, manages, managersOf, type ManagerField } from './managers'
import { nameKey } from './text'
import type { ARecruter, Commercial, MapData, Priorite, Structure } from './types'
import { PARIS_ARR_CODES, ZONES, compareZoneCodes, isParisArr } from './zones'

export const PRIORITES: { value: Priorite; label: string; detail: string; color: string }[] = [
  { value: 1, label: 'Priorité 1', detail: 'à recruter en premier', color: '#c4320a' },
  { value: 2, label: 'Priorité 2', detail: 'ensuite', color: '#e08600' },
  { value: 3, label: 'Priorité 3', detail: 'plus tard', color: '#2f8fb3' },
]

/** À recruter, dans un groupe mais sans priorité. */
export const NO_PRIORITY_COLOR = '#8794a6'
export const prioriteColor = (p: Priorite | null) => PRIORITES.find((x) => x.value === p)?.color ?? NO_PRIORITY_COLOR
export const prioriteLabel = (p: Priorite | null) => (p ? `Priorité ${p}` : 'Sans priorité')

/** Les zones élémentaires d'un code : les 20 arrondissements pour « 75 ». */
export const atomsOf = (code: string): readonly string[] => (code === '75' ? PARIS_ARR_CODES : [code])

export type Occupancy = Map<Structure, Map<string, Commercial[]>>

/** Les commerciaux actifs de chaque zone élémentaire, par structure (sans les filtres de la carte). */
export function occupancyOf(data: Pick<MapData, 'commerciaux' | 'affectations'>): Occupancy {
  const byId = new Map(data.commerciaux.map((c) => [c.id, c]))
  const out: Occupancy = new Map()
  for (const a of data.affectations) {
    const c = byId.get(a.commercial_id)
    if (!c?.actif) continue
    const zones = out.get(a.structure) ?? new Map<string, Commercial[]>()
    out.set(a.structure, zones)
    for (const atom of atomsOf(a.zone_code)) zones.set(atom, [...(zones.get(atom) ?? []).filter((x) => x !== c), c])
  }
  return out
}

export interface Vacancy {
  structure: Structure
  priorite: Priorite | null
  secteurs: string[]
  /** Paris : arrondissements à recruter, quand une partie seulement l'est. */
  arrondissements: string[] | null
  /** Quelqu'un y est déjà : le département est marqué à recruter quand même (D-016). */
  occupied: boolean
}

/** Marqué : une priorité ou un groupe (un département vide sans rien n'est qu'à prendre). */
export const isMarked = (v: Pick<Vacancy, 'priorite' | 'secteurs'>) => v.priorite !== null || v.secteurs.length > 0

/** Une ligne vaut pour cet arrondissement, ce département, ou tout Paris. */
const covers = (r: ARecruter, atom: string) => r.zone_code === atom || (r.zone_code === '75' && isParisArr(atom))

/** « groupe Centre » ; un nom qui dit déjà « Groupe Est » ou « Secteur Est » reste tel quel. */
export const groupLabel = (s: string) => (/^(groupe|secteur)\b/i.test(s) ? s : `groupe ${s}`)

/** « Priorité 1 · groupe Centre » ; « sans priorité » quand rien n'est décidé. */
export const vacancyText = (v: Vacancy) =>
  [v.priorite || v.secteurs.length ? prioriteLabel(v.priorite) : null, v.secteurs.length ? v.secteurs.map(groupLabel).join(', ') : null].filter(Boolean).join(' · ') ||
  'sans priorité'

/** Ce qu'une structure a à recruter dans une zone : ses parties vides, et celles marquées même occupées ; null sinon. */
export function vacancyIn(code: string, structure: Structure, occupancy: Occupancy, rows: readonly ARecruter[]): Vacancy | null {
  const atoms = atomsOf(code)
  const taken = occupancy.get(structure)
  const busy = (atom: string) => Boolean(taken?.get(atom)?.length)
  const mine = rows.filter((r) => r.structure === structure && atoms.some((atom) => covers(r, atom)))
  const open = atoms.filter((atom) => !busy(atom) || mine.some((r) => covers(r, atom)))
  if (!open.length) return null
  const priorites = mine.map((r) => r.priorite).filter((p): p is Priorite => p !== null)
  return {
    structure,
    priorite: priorites.length ? (Math.min(...priorites) as Priorite) : null,
    secteurs: [...new Set(mine.map((r) => r.secteur).filter((s): s is string => Boolean(s)))].sort((a, b) => a.localeCompare(b, 'fr')),
    arrondissements: open.length < atoms.length ? open : null,
    occupied: open.some(busy),
  }
}

/** Les groupes d'une structure et leurs départements, dans l'ordre (pour les attribuer à un commercial). */
export function groupsOf(rows: readonly ARecruter[], structure: Structure): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const r of rows) if (r.structure === structure && r.secteur) out.set(r.secteur, [...(out.get(r.secteur) ?? []), r.zone_code])
  return new Map(
    [...out]
      .sort(([a], [b]) => a.localeCompare(b, 'fr'))
      .map(([g, codes]) => [g, codes.sort(compareZoneCodes)]),
  )
}

/** Toutes les zones vides d'une structure (Paris entier s'il l'est, sinon ses arrondissements vides), dans l'ordre. */
export function vacantZones(structure: Structure, occupancy: Occupancy): string[] {
  const taken = occupancy.get(structure)
  const free = (code: string) => !taken?.get(code)?.length
  const parisFree = PARIS_ARR_CODES.filter(free)
  const codes = ZONES.filter((z) => z.type !== 'arrondissement' && z.code !== '75' && free(z.code)).map((z) => z.code)
  return [...codes, ...(parisFree.length === PARIS_ARR_CODES.length ? ['75'] : parisFree)].sort(compareZoneCodes)
}

/**
 * Zones qu'un manager ne peut pas ajouter à un de ses commerciaux, avec qui y est : un commercial actif
 * d'un autre manager. Celles que le commercial a déjà lui restent ouvertes. La base vérifie la même chose.
 */
export function blockedZones(data: MapData, commercial: Commercial, structure: Structure, manager: string, active: readonly ManagerField[]): Map<string, string> {
  const taken = occupancyOf(data).get(structure) ?? new Map<string, Commercial[]>()
  const own = new Set(
    data.affectations.filter((a) => a.commercial_id === commercial.id && a.structure === structure).flatMap((a) => atomsOf(a.zone_code)),
  )
  const fiches = fichesOf(data.managers)
  const reasons = new Map<string, string>()
  for (const [atom, people] of taken) {
    if (own.has(atom)) continue
    const other = people.find((c) => c.id !== commercial.id && !manages(manager, c, active, fiches))
    if (!other) continue
    const chief = fiches.get(other.id) ?? managersOf(other, active).join(', ')
    reasons.set(atom, `${other.nom}${chief && !fiches.has(other.id) ? ` (${chief})` : fiches.has(other.id) ? ' (manager)' : ''}`)
  }
  const paris = PARIS_ARR_CODES.filter((c) => reasons.has(c))
  if (paris.length) reasons.set('75', reasons.get(paris[0])!)
  return reasons
}

/** Une ancienne fiche « À recruter » (faux commercial, par son nom ou son statut), à convertir en départements vides. */
export const isARecruter = (c: Pick<Commercial, 'nom' | 'statut'>) =>
  nameKey(c.statut).startsWith('a recruter') || nameKey(c.nom).startsWith('a recruter')

/** Le groupe qu'une ancienne fiche laisse à ses départements (même règle que convertir_a_recruter() en base). */
export const sectorOf = (c: Pick<Commercial, 'nom' | 'secteur'>) =>
  c.nom.replace(/^\s*[aà]\s+recruter\s*[-–—:]?\s*/i, '').trim() || c.secteur?.trim() || null

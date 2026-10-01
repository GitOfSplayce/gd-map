// Aperçu des changements d'un import Excel et construction des données envoyées à apply_import.
import { pickDistinctColor } from './colors'
import type { ImportRow } from './excel'
import { nameKey } from './text'
import { formatZoneList } from './parseZones'
import {
  STRUCTURES,
  type Affectation,
  type Commercial,
  type CommercialPayload,
  type Couverture,
  type Objectif,
  type Structure,
  type ZoneAssignment,
} from './types'

export type ImportMode = 'merge' | 'replace'

export interface FieldChange {
  label: string
  before: string
  after: string
}

export interface ZoneChange {
  structure: Structure
  added: string[]
  removed: string[]
  changed: string[]
}

export interface DiffItem {
  kind: 'add' | 'update' | 'unchanged' | 'delete'
  nom: string
  row?: ImportRow
  existing?: Commercial
  fields: FieldChange[]
  zones: ZoneChange[]
}

export interface ImportPlan {
  items: DiffItem[]
  duplicates: ImportRow[]
  payload: CommercialPayload[]
  deleteIds: string[]
  counts: Record<DiffItem['kind'], number>
}

const SUFFIX: Record<Couverture, string> = { propre: '', partiel: 'P', gestion: 'G' }
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v))
const same = (a: unknown, b: unknown) => show(a).trim() === show(b).trim()

export function rowAssignments(row: ImportRow): ZoneAssignment[] {
  return STRUCTURES.flatMap((s) => row.zones[s].map((z) => ({ structure: s, zone_code: z.code, couverture: z.couverture })))
}

function compareZones(before: ZoneAssignment[], after: ZoneAssignment[]): ZoneChange[] {
  const changes: ZoneChange[] = []
  for (const s of STRUCTURES) {
    const b = new Map(before.filter((a) => a.structure === s).map((a) => [a.zone_code, a.couverture]))
    const a = new Map(after.filter((x) => x.structure === s).map((x) => [x.zone_code, x.couverture]))
    const added = [...a].filter(([code]) => !b.has(code)).map(([code, c]) => code + SUFFIX[c])
    const removed = [...b].filter(([code]) => !a.has(code)).map(([code, c]) => code + SUFFIX[c])
    const changed = [...a]
      .filter(([code, c]) => b.has(code) && b.get(code) !== c)
      .map(([code, c]) => `${code}${SUFFIX[b.get(code)!]} → ${code}${SUFFIX[c]}`)
    if (added.length || removed.length || changed.length) changes.push({ structure: s, added, removed, changed })
  }
  return changes
}

function compareFields(row: ImportRow, c: Commercial, objectifs: Objectif[], annee: number): FieldChange[] {
  const out: FieldChange[] = []
  const check = (label: string, before: unknown, after: unknown) => {
    if (!same(before, after)) out.push({ label, before: show(before), after: show(after) })
  }
  check('Nom', c.nom, row.nom)
  check('Structures', [...c.structures].sort().join(', '), [...row.structures].sort().join(', '))
  check('Statut', c.statut, row.statut)
  check('Nb de jour / an', c.jours_an, row.jours_an)
  check('Manager 1', c.manager1, row.manager1)
  check('Date 1', c.date_manager1, row.date_manager1)
  check('Manager 2', c.manager2, row.manager2)
  check('Date 2', c.date_manager2, row.date_manager2)
  check('Actions', c.actions, row.actions)
  check('Région', c.secteur, row.secteur)
  if (row.couleur !== undefined) check('Couleur', c.couleur, row.couleur)
  if (row.actif !== undefined) check('Actif', c.actif ? 'Oui' : 'Non', row.actif ? 'Oui' : 'Non')
  if (row.notes !== undefined) check('Notes', c.notes, row.notes)
  for (const s of STRUCTURES) {
    const o = objectifs.find((x) => x.commercial_id === c.id && x.structure === s && x.annee === annee)
    const n = row.objectifs.find((x) => x.structure === s)
    check(`CA ${s} ${annee}`, o?.ca, n?.ca)
    check(`Objectif ${s} ${annee}`, o?.objectif, n?.objectif)
  }
  return out
}

function rowPayload(row: ImportRow, ordre: number, annee: number): CommercialPayload {
  const p: CommercialPayload = {
    nom: row.nom,
    structures: row.structures,
    statut: row.statut,
    jours_an: row.jours_an,
    manager1: row.manager1,
    date_manager1: row.date_manager1,
    manager2: row.manager2,
    date_manager2: row.date_manager2,
    actions: row.actions,
    secteur: row.secteur,
    ordre,
    affectations: rowAssignments(row),
    // Les CA/objectifs absents du fichier sont effacés pour l'année importée
    objectifs: STRUCTURES.map((s) => {
      const o = row.objectifs.find((x) => x.structure === s)
      return { structure: s, annee, ca: o?.ca ?? null, objectif: o?.objectif ?? null }
    }),
  }
  if (row.couleur !== undefined) p.couleur = row.couleur
  if (row.actif !== undefined) p.actif = row.actif
  if (row.notes !== undefined) p.notes = row.notes
  return p
}

export function planImport(
  rows: ImportRow[],
  current: { commerciaux: Commercial[]; affectations: Affectation[]; objectifs: Objectif[] },
  mode: ImportMode,
  annee: number,
): ImportPlan {
  const byName = new Map(current.commerciaux.map((c) => [nameKey(c.nom), c]))
  const seen = new Set<string>()
  const duplicates: ImportRow[] = []
  const items: DiffItem[] = []
  const payload: CommercialPayload[] = []
  const usedColors = current.commerciaux.map((c) => c.couleur)

  rows.forEach((row, i) => {
    const key = nameKey(row.nom)
    if (seen.has(key)) {
      duplicates.push(row)
      return
    }
    seen.add(key)
    const existing = byName.get(key)
    const p = rowPayload(row, i + 1, annee)

    if (!existing) {
      if (!p.couleur) p.couleur = pickDistinctColor(usedColors)
      usedColors.push(p.couleur)
      items.push({ kind: 'add', nom: row.nom, row, fields: [], zones: compareZones([], p.affectations!) })
    } else {
      p.id = existing.id
      const fields = compareFields(row, existing, current.objectifs, annee)
      const zones = compareZones(
        current.affectations.filter((a) => a.commercial_id === existing.id),
        p.affectations!,
      )
      items.push({
        kind: fields.length || zones.length ? 'update' : 'unchanged',
        nom: row.nom,
        row,
        existing,
        fields,
        zones,
      })
    }
    payload.push(p)
  })

  const deleteIds: string[] = []
  if (mode === 'replace') {
    for (const c of current.commerciaux) {
      if (seen.has(nameKey(c.nom))) continue
      deleteIds.push(c.id)
      const own = current.affectations.filter((a) => a.commercial_id === c.id)
      items.push({
        kind: 'delete',
        nom: c.nom,
        existing: c,
        fields: [],
        zones: STRUCTURES.filter((s) => own.some((a) => a.structure === s)).map((s) => ({
          structure: s,
          added: [],
          removed: formatZoneList(own.filter((a) => a.structure === s)).split(', '),
          changed: [],
        })),
      })
    }
  }

  const counts = { add: 0, update: 0, unchanged: 0, delete: 0 }
  for (const it of items) counts[it.kind]++
  return { items, duplicates, payload, deleteIds, counts }
}

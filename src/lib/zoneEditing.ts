// Édition des zones d'un commercial par l'assistant (carte ou liste) : même résultat que la saisie au format Excel.
import { formatZoneList, parseZoneList } from './parseZones'
import type { Couverture } from './types'
import { PARIS_ARR_CODES, isParisArr } from './zones'

export type ZoneSelection = Map<string, Couverture>

export function selectionFromText(text: string): ZoneSelection {
  return new Map(parseZoneList(text).zones.map((z) => [z.code, z.couverture]))
}

/** Texte au format Excel ; les 20 arrondissements de même couverture redeviennent « 75 ». */
export function selectionToText(sel: ZoneSelection): string {
  const compact = new Map(sel)
  const arrs = PARIS_ARR_CODES.map((c) => compact.get(c))
  if (!compact.has('75') && arrs.every((c) => c && c === arrs[0])) {
    for (const c of PARIS_ARR_CODES) compact.delete(c)
    compact.set('75', arrs[0]!)
  }
  return formatZoneList([...compact].map(([zone_code, couverture]) => ({ zone_code, couverture })))
}

/** Couverture effective d'une zone (un arrondissement hérite de « 75 »). */
export function coverageIn(sel: ZoneSelection, code: string): Couverture | undefined {
  return sel.get(code) ?? (isParisArr(code) ? sel.get('75') : undefined)
}

/**
 * Clic sur une zone avec un « pinceau » de couverture :
 * absente → ajoutée ; même couverture → retirée ; autre couverture → remplacée.
 */
export function toggleZone(sel: ZoneSelection, code: string, brush: Couverture): ZoneSelection {
  const next = new Map(sel)
  if (code === '75') {
    // Tout Paris : remplace le détail par arrondissement
    const had = next.get('75')
    for (const c of PARIS_ARR_CODES) next.delete(c)
    if (had === brush) next.delete('75')
    else next.set('75', brush)
    return next
  }
  if (isParisArr(code) && next.has('75')) {
    // Un arrondissement dans « 75 » : on détaille Paris pour pouvoir le modifier seul
    const paris = next.get('75')!
    next.delete('75')
    for (const c of PARIS_ARR_CODES) next.set(c, paris)
  }
  if (next.get(code) === brush) next.delete(code)
  else next.set(code, brush)
  return next
}

/** Ajoute (ou retire, si toutes y sont déjà avec ce pinceau) un groupe de zones d'un coup. */
export function toggleGroup(sel: ZoneSelection, codes: string[], brush: Couverture): ZoneSelection {
  const all = codes.every((c) => coverageIn(sel, c) === brush)
  let next = new Map(sel)
  for (const c of codes) {
    const has = coverageIn(next, c) === brush
    if (all ? has : !has) next = toggleZone(next, c, brush)
  }
  return next
}

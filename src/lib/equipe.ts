// L'équipe du manager connecté (D-010).
import { activeManagers, manages } from './managers'
import { structureCodes } from './structures'
import type { Commercial, MapData } from './types'

/** Les commerciaux d'un manager, actifs d'abord. */
export const teamOf = (data: MapData) => {
  const active = activeManagers(data.settings)
  return data.commerciaux
    .filter((c) => data.manager && manages(data.manager.nom, c, active))
    .sort((a, b) => Number(b.actif) - Number(a.actif) || a.nom.localeCompare(b.nom, 'fr'))
}

/** Les structures d'un commercial que le manager gère, dans l'ordre de la carte. */
export const myStructures = (data: MapData, c: Commercial) =>
  structureCodes(data.structures).filter((s) => c.structures.includes(s) && data.manager!.structures.includes(s))

// L'équipe du manager connecté (D-010).
import { activeManagers, fichesOf, manages } from './managers'
import { structureCodes } from './structures'
import type { Commercial, MapData } from './types'

/** Est-ce la propre fiche du manager connecté ? */
export const isMine = (data: MapData, c: Commercial) => Boolean(data.manager) && fichesOf(data.managers).get(c.id) === data.manager!.nom

/** Les commerciaux d'un manager : sa propre fiche d'abord, puis les actifs. */
export const teamOf = (data: MapData) => {
  const active = activeManagers(data.settings)
  const fiches = fichesOf(data.managers)
  return data.commerciaux
    .filter((c) => data.manager && manages(data.manager.nom, c, active, fiches))
    .sort((a, b) => Number(isMine(data, b)) - Number(isMine(data, a)) || Number(b.actif) - Number(a.actif) || a.nom.localeCompare(b.nom, 'fr'))
}

/** Les structures d'un commercial que le manager gère, dans l'ordre de la carte. */
export const myStructures = (data: MapData, c: Commercial) =>
  structureCodes(data.structures).filter((s) => c.structures.includes(s) && data.manager!.structures.includes(s))

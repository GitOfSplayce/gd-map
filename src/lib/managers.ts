// Manager 1 et Manager 2 se désactivent pour toute la carte (Paramètres) : un manager désactivé n'a plus
// de vue, de filtre ni de droits ; rien n'est effacé.
import type { Commercial, DisplaySettings, Manager } from './types'

export type ManagerField = 'manager1' | 'manager2'

/** Les managers actifs, dans l'ordre. Sans réglage connu, les deux. */
export function activeManagers(settings?: Partial<DisplaySettings>): ManagerField[] {
  const out: ManagerField[] = []
  if (settings?.manager1_actif !== false) out.push('manager1')
  if (settings?.manager2_actif !== false) out.push('manager2')
  return out
}

/** « Manager 1 », « Manager 2 » ; « Manager » quand il n'en reste qu'un. */
export const managerLabel = (field: ManagerField, active: readonly ManagerField[]) =>
  active.length === 1 && active[0] === field ? 'Manager' : field === 'manager1' ? 'Manager 1' : 'Manager 2'

/** Fiche de commercial → le manager dont c'est la fiche (D-013). */
export type Fiches = ReadonlyMap<string, string>
export const fichesOf = (managers: readonly Pick<Manager, 'nom' | 'commercial_id'>[] = []): Fiches =>
  new Map(managers.flatMap((m) => (m.commercial_id ? [[m.commercial_id, m.nom] as const] : [])))

/** Ce manager gère-t-il ce commercial ? Par un manager actif, ou parce que c'est sa fiche (même règle que gere() en base). */
export const manages = (nom: string, c: Pick<Commercial, 'id' | 'manager1' | 'manager2'>, active: readonly ManagerField[], fiches: Fiches) =>
  active.some((f) => c[f] === nom) || fiches.get(c.id) === nom

/** L'équipe où compte un commercial, sur la carte et dans les totaux : la fiche d'un manager compte dans la sienne. */
export const teamManager = (c: Pick<Commercial, 'id' | 'manager1' | 'manager2'>, field: ManagerField, fiches: Fiches) => fiches.get(c.id) ?? c[field]

/** Les managers actifs d'un commercial, sans doublon. */
export const managersOf = (c: Pick<Commercial, 'manager1' | 'manager2'>, active: readonly ManagerField[]) =>
  [...new Set(active.map((f) => c[f]).filter((nom): nom is string => Boolean(nom)))]

// Mode démo (npm run demo) : la carte fonctionne sans serveur ni base, avec des données fictives.
// Absent du build de production : n'est importé que si VITE_DEMO=1.
import sample from './demoData.json'
import { DEFAULT_STRUCTURES, type StructureDef } from './structures'
import type { ARecruter, Commercial, CommercialPayload, DisplaySettings, Manager, MapData, Objectif, ZoneAssignment } from './types'

// Coordonnées fictives de quelques managers (numéros réservés à la fiction par l'ARCEP)
const DEMO_MANAGERS: Record<string, Partial<Manager>> = {
  Hélène: { telephone: '06 39 98 00 51', email: 'helene.martin@example.com', compte: 'helene.martin@example.com' },
  Inès: { telephone: '06 39 98 00 52', email: 'ines.garnier@example.com' },
}

/** Les données d'exemple, telles qu'elles seraient en base (identifiants fictifs). */
export function demoData(): MapData {
  const payloads = sample.commerciaux as unknown as CommercialPayload[]
  const commerciaux = payloads.map(({ affectations: _a, objectifs: _o, ...p }, i) => ({ actif: true, notes: null, ...p, id: `demo-${i}` }) as Commercial)
  const managers: Manager[] = [...new Set(commerciaux.flatMap((c) => [c.manager1, c.manager2]).filter(Boolean) as string[])]
    .sort((a, b) => a.localeCompare(b, 'fr'))
    .map((nom) => ({
      nom,
      couleur: null,
      structures: [...new Set(commerciaux.filter((c) => c.manager1 === nom || c.manager2 === nom).flatMap((c) => c.structures))].sort(),
      compte: null,
      ...DEMO_MANAGERS[nom],
    }))
  return {
    admin: true,
    chiffres: true,
    manager: null,
    settings: { default_shared_mode: 'rayures', manager1_actif: true, manager2_actif: true },
    structures: DEFAULT_STRUCTURES,
    commerciaux,
    managers,
    affectations: payloads.flatMap((p, i) => p.affectations!.map((a, j) => ({ ...a, id: `demo-${i}-${j}`, commercial_id: `demo-${i}` }))),
    objectifs: payloads.flatMap((p, i) => p.objectifs!.map((o) => ({ ...o, commercial_id: `demo-${i}` }))),
    a_recruter: sample.a_recruter as ARecruter[],
    updated_at: new Date().toISOString(),
  }
}

// --- Admin en mémoire (mode démo) : les modifications sont perdues au rechargement de la page

let store: MapData | null = null

async function getStore(): Promise<MapData> {
  store ??= demoData()
  return store
}

export async function demoMapData(): Promise<MapData> {
  const data = structuredClone(await getStore())
  // Même tri que get_map_data
  data.commerciaux.sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom, 'fr'))
  return data
}

/**
 * Un département où un commercial arrive en propre, ou y passe, n'est plus à recruter (comme le déclencheur
 * en base, D-016, sans le détail de Paris). En gestion ou en partiel, il le reste.
 */
function fill(s: MapData, zones: ZoneAssignment[], before: readonly ZoneAssignment[]) {
  const wasPropre = (z: ZoneAssignment) => before.some((b) => b.structure === z.structure && b.zone_code === z.zone_code && b.couverture === 'propre')
  const arrived = zones.filter((z) => z.couverture === 'propre' && !wasPropre(z))
  s.a_recruter = s.a_recruter.filter((r) => !arrived.some((z) => z.structure === r.structure && z.zone_code === r.zone_code))
}

function writeFigures(s: MapData, id: string, objectifs: Omit<Objectif, 'commercial_id'>[]) {
  s.objectifs = [
    ...s.objectifs.filter((o) => o.commercial_id !== id || !objectifs.some((n) => n.structure === o.structure && n.annee === o.annee)),
    ...objectifs.filter((o) => o.ca !== null || o.objectif !== null).map((o) => ({ ...o, commercial_id: id })),
  ]
}

export async function demoSave(p: CommercialPayload): Promise<string> {
  const s = await getStore()
  for (const nom of [p.manager1, p.manager2]) {
    if (nom?.trim() && !s.managers.some((m) => m.nom === nom.trim())) s.managers.push({ nom: nom.trim(), couleur: null, structures: [], compte: null })
  }
  const id = p.id ?? `demo-${crypto.randomUUID()}`
  const existing = s.commerciaux.find((c) => c.id === id)
  const { affectations, objectifs, ...fields } = p
  if (existing) Object.assign(existing, fields)
  else s.commerciaux.push({ actif: true, statut: null, manager1: null, manager2: null, couleur: '#4363d8', structures: [], secteur: null, ordre: s.commerciaux.length + 1, ...fields, id, nom: p.nom ?? '' } as Commercial)
  if (affectations) {
    const before = s.affectations.filter((a) => a.commercial_id === id)
    s.affectations = [...s.affectations.filter((a) => a.commercial_id !== id), ...affectations.map((a, i) => ({ ...a, id: `${id}-${i}`, commercial_id: id }))]
    if (existing?.actif ?? true) fill(s, affectations, before)
  }
  if (objectifs) writeFigures(s, id, objectifs)
  s.updated_at = new Date().toISOString()
  return id
}

export async function demoSaveEquipe(id: string, patch: { affectations?: ZoneAssignment[]; objectifs?: Omit<Objectif, 'commercial_id'>[] }) {
  await demoSave({ id, ...patch })
}

export async function demoDelete(id: string) {
  const s = await getStore()
  s.commerciaux = s.commerciaux.filter((c) => c.id !== id)
  s.affectations = s.affectations.filter((a) => a.commercial_id !== id)
  s.objectifs = s.objectifs.filter((o) => o.commercial_id !== id)
}

export async function demoSetRecrutement(structure: string, zones: Omit<ARecruter, 'structure'>[]) {
  const s = await getStore()
  s.a_recruter = [
    ...s.a_recruter.filter((r) => r.structure !== structure || !zones.some((z) => z.zone_code === r.zone_code)),
    ...zones.filter((z) => z.priorite !== null || z.secteur).map((z) => ({ ...z, structure })),
  ]
}

export async function demoCreateManager(m: Pick<Manager, 'nom' | 'couleur'>) {
  const s = await getStore()
  if (s.managers.some((x) => x.nom === m.nom.trim())) throw new Error('Un manager porte déjà ce nom.')
  s.managers.push({ nom: m.nom.trim(), couleur: m.couleur, structures: [], compte: null })
}

export async function demoSetManagerColor(nom: string, couleur: string) {
  const s = await getStore()
  const m = s.managers.find((x) => x.nom === nom)
  if (m) m.couleur = couleur
}

export async function demoUpdateManager(nom: string, patch: Partial<Manager>) {
  const s = await getStore()
  const m = s.managers.find((x) => x.nom === nom)
  if (m) Object.assign(m, patch)
}

export async function demoRenameManager(oldName: string, newName: string) {
  const s = await getStore()
  const target = newName.trim()
  for (const c of s.commerciaux) {
    if (c.manager1 === oldName) c.manager1 = target
    if (c.manager2 === oldName) c.manager2 = target
  }
  if (s.managers.some((m) => m.nom === target)) s.managers = s.managers.filter((m) => m.nom !== oldName)
  else s.managers = s.managers.map((m) => (m.nom === oldName ? { ...m, nom: target } : m))
}

export async function demoDeleteManager(nom: string) {
  const s = await getStore()
  for (const c of s.commerciaux) {
    if (c.manager1 === nom) c.manager1 = null
    if (c.manager2 === nom) c.manager2 = null
  }
  s.managers = s.managers.filter((m) => m.nom !== nom)
}

export async function demoCreateStructure(def: StructureDef) {
  const s = await getStore()
  if (s.structures.some((x) => x.code === def.code)) throw new Error('Une structure porte déjà ce code.')
  s.structures = [...s.structures, def]
}

export async function demoUpdateStructure(code: string, patch: { code: string; nom: string }) {
  const s = await getStore()
  if (patch.code !== code && s.structures.some((x) => x.code === patch.code)) throw new Error('Une structure porte déjà ce code.')
  s.structures = s.structures.map((x) => (x.code === code ? { ...x, ...patch } : x))
  if (patch.code === code) return
  const rename = (list: string[] = []) => list.map((x) => (x === code ? patch.code : x))
  for (const c of s.commerciaux) c.structures = rename(c.structures)
  for (const m of s.managers) m.structures = rename(m.structures)
  for (const list of [s.affectations, s.objectifs, s.a_recruter]) for (const x of list) if (x.structure === code) x.structure = patch.code
}

export async function demoDeleteStructure(code: string) {
  const s = await getStore()
  s.structures = s.structures.filter((x) => x.code !== code)
  for (const c of s.commerciaux) c.structures = c.structures.filter((x) => x !== code)
  for (const m of s.managers) m.structures = m.structures?.filter((x) => x !== code)
  s.affectations = s.affectations.filter((a) => a.structure !== code)
  s.objectifs = s.objectifs.filter((o) => o.structure !== code)
  s.a_recruter = s.a_recruter.filter((r) => r.structure !== code)
}

export async function demoReorderStructures(codes: string[]) {
  const s = await getStore()
  s.structures = s.structures.map((x) => (codes.includes(x.code) ? { ...x, ordre: codes.indexOf(x.code) + 1 } : x))
}

export async function demoSetDefaultSharedMode(mode: DisplaySettings['default_shared_mode']) {
  const s = await getStore()
  s.settings = { ...s.settings!, default_shared_mode: mode }
}

export async function demoSetManagersActifs(manager1: boolean, manager2: boolean) {
  if (!manager1 && !manager2) throw new Error('Manager 1 ou Manager 2 doit rester actif')
  const s = await getStore()
  s.settings = { ...s.settings!, manager1_actif: manager1, manager2_actif: manager2 }
}

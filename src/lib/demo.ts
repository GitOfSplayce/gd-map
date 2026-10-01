// Mode démo (npm run demo) : la carte fonctionne sans Supabase, avec le fichier d'exemple fictif.
// Absent du build de production : n'est importé que si VITE_DEMO=1.
import sampleUrl from '../../exemples/exemple-import.xlsx?url'
import { parseSheet, readWorkbook } from './excel'
import { planImport, type ImportPlan } from './importDiff'
import { DEFAULT_STRUCTURES, structureCodes, type StructureDef } from './structures'
import type { Commercial, CommercialPayload, DisplaySettings, Manager, MapData } from './types'

/** Données telles qu'elles seraient en base après l'import du plan (identifiants fictifs). */
export function planToMapData(plan: ImportPlan, structures: StructureDef[] = DEFAULT_STRUCTURES): MapData {
  const commerciaux = plan.payload.map((p, i) => ({
    id: `demo-${i}`,
    nom: p.nom!,
    statut: p.statut ?? null,
    manager1: p.manager1 ?? null,
    manager2: p.manager2 ?? null,
    couleur: p.couleur!,
    actif: p.actif ?? true,
    notes: p.notes ?? null,
    structures: p.structures!,
    secteur: p.secteur ?? null,
    jours_an: p.jours_an ?? null,
    date_manager1: p.date_manager1 ?? null,
    date_manager2: p.date_manager2 ?? null,
    actions: p.actions ?? null,
    ordre: p.ordre!,
  }))
  const managers: Manager[] = [...new Set(commerciaux.flatMap((c) => [c.manager1, c.manager2]).filter(Boolean) as string[])]
    .sort((a, b) => a.localeCompare(b, 'fr'))
    .map((nom) => ({ nom, couleur: null }))
  return {
    admin: false,
    structures,
    commerciaux,
    managers,
    affectations: plan.payload.flatMap((p, i) => p.affectations!.map((a, j) => ({ ...a, id: `demo-${i}-${j}`, commercial_id: `demo-${i}` }))),
    objectifs: plan.payload.flatMap((p, i) =>
      p.objectifs!.filter((o) => o.ca !== null || o.objectif !== null).map((o) => ({ ...o, commercial_id: `demo-${i}` })),
    ),
    updated_at: new Date().toISOString(),
  }
}

export async function loadDemoData(): Promise<MapData> {
  const buf = await (await fetch(sampleUrl)).arrayBuffer()
  const { rows } = parseSheet(readWorkbook(buf), 'V3', structureCodes(DEFAULT_STRUCTURES))
  const empty = { structures: DEFAULT_STRUCTURES, commerciaux: [], affectations: [], objectifs: [] }
  const plan = planImport(rows, empty, 'replace', new Date().getFullYear())
  return planToMapData(plan)
}

// --- Admin en mémoire (mode démo) : les modifications sont perdues au rechargement de la page

let store: MapData | null = null

async function getStore(): Promise<MapData> {
  store ??= { ...(await loadDemoData()), admin: true, settings: { default_shared_mode: 'rayures' } }
  return store
}

export async function demoMapData(): Promise<MapData> {
  const data = structuredClone(await getStore())
  // Même tri que get_map_data
  data.commerciaux.sort((a, b) => a.ordre - b.ordre || a.nom.localeCompare(b.nom, 'fr'))
  return data
}

export async function demoSave(p: CommercialPayload): Promise<string> {
  const s = await getStore()
  for (const nom of [p.manager1, p.manager2]) {
    if (nom?.trim() && !s.managers.some((m) => m.nom === nom.trim())) s.managers.push({ nom: nom.trim(), couleur: null })
  }
  const id = p.id ?? `demo-${crypto.randomUUID()}`
  const existing = s.commerciaux.find((c) => c.id === id)
  const { affectations, objectifs, ...fields } = p
  if (existing) Object.assign(existing, fields)
  else s.commerciaux.push({ actif: true, statut: null, manager1: null, manager2: null, couleur: '#4363d8', structures: [], secteur: null, ordre: s.commerciaux.length + 1, ...fields, id, nom: p.nom ?? '' } as Commercial)
  if (affectations) {
    s.affectations = [...s.affectations.filter((a) => a.commercial_id !== id), ...affectations.map((a, i) => ({ ...a, id: `${id}-${i}`, commercial_id: id }))]
  }
  if (objectifs) {
    s.objectifs = [
      ...s.objectifs.filter((o) => o.commercial_id !== id || !objectifs.some((n) => n.structure === o.structure && n.annee === o.annee)),
      ...objectifs.filter((o) => o.ca !== null || o.objectif !== null).map((o) => ({ ...o, commercial_id: id })),
    ]
  }
  s.updated_at = new Date().toISOString()
  return id
}

export async function demoDelete(id: string) {
  const s = await getStore()
  s.commerciaux = s.commerciaux.filter((c) => c.id !== id)
  s.affectations = s.affectations.filter((a) => a.commercial_id !== id)
  s.objectifs = s.objectifs.filter((o) => o.commercial_id !== id)
}

export async function demoApplyImport(items: CommercialPayload[], deleteIds: string[]) {
  for (const id of deleteIds) await demoDelete(id)
  for (const item of items) await demoSave(item)
  return { saved: items.length, deleted: deleteIds.length }
}

export async function demoCreateManager(m: Manager) {
  const s = await getStore()
  if (s.managers.some((x) => x.nom === m.nom.trim())) throw new Error('Un manager porte déjà ce nom.')
  s.managers.push({ nom: m.nom.trim(), couleur: m.couleur })
}

export async function demoSetManagerColor(nom: string, couleur: string) {
  const s = await getStore()
  const m = s.managers.find((x) => x.nom === nom)
  if (m) m.couleur = couleur
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
  for (const c of s.commerciaux) c.structures = c.structures.map((x) => (x === code ? patch.code : x))
  for (const a of s.affectations) if (a.structure === code) a.structure = patch.code
  for (const o of s.objectifs) if (o.structure === code) o.structure = patch.code
}

export async function demoDeleteStructure(code: string) {
  const s = await getStore()
  s.structures = s.structures.filter((x) => x.code !== code)
  for (const c of s.commerciaux) c.structures = c.structures.filter((x) => x !== code)
  s.affectations = s.affectations.filter((a) => a.structure !== code)
  s.objectifs = s.objectifs.filter((o) => o.structure !== code)
}

export async function demoReorderStructures(codes: string[]) {
  const s = await getStore()
  s.structures = s.structures.map((x) => (codes.includes(x.code) ? { ...x, ordre: codes.indexOf(x.code) + 1 } : x))
}

export async function demoSetDefaultSharedMode(mode: DisplaySettings['default_shared_mode']) {
  const s = await getStore()
  s.settings = { default_shared_mode: mode }
}

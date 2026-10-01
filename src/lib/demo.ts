// Mode démo (npm run demo) : la carte fonctionne sans Supabase, avec le fichier d'exemple fictif.
// Absent du build de production : n'est importé que si VITE_DEMO=1.
import sampleUrl from '../../exemples/exemple-import.xlsx?url'
import { parseSheet, readWorkbook } from './excel'
import { planImport, type ImportPlan } from './importDiff'
import type { Commercial, CommercialPayload, MapData } from './types'

/** Données telles qu'elles seraient en base après l'import du plan (identifiants fictifs). */
export function planToMapData(plan: ImportPlan): MapData {
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
  return {
    admin: false,
    commerciaux,
    affectations: plan.payload.flatMap((p, i) => p.affectations!.map((a, j) => ({ ...a, id: `demo-${i}-${j}`, commercial_id: `demo-${i}` }))),
    objectifs: plan.payload.flatMap((p, i) =>
      p.objectifs!.filter((o) => o.ca !== null || o.objectif !== null).map((o) => ({ ...o, commercial_id: `demo-${i}` })),
    ),
    updated_at: new Date().toISOString(),
  }
}

export async function loadDemoData(): Promise<MapData> {
  const buf = await (await fetch(sampleUrl)).arrayBuffer()
  const { rows } = parseSheet(readWorkbook(buf), 'V3')
  const plan = planImport(rows, { commerciaux: [], affectations: [], objectifs: [] }, 'replace', new Date().getFullYear())
  return planToMapData(plan)
}

// --- Admin en mémoire (mode démo) : les modifications sont perdues au rechargement de la page

let store: MapData | null = null

async function getStore(): Promise<MapData> {
  store ??= { ...(await loadDemoData()), admin: true }
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

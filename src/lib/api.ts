import type { StructureDef } from './structures'
import type { CommercialPayload, DisplaySettings, JournalLine, Manager, MapData, Objectif, Priorite, ZoneAssignment } from './types'

// Appels à l'API de la carte (server/app.ts), sur la même origine que le site : le cookie de session
// part de lui-même. Les droits sont vérifiés côté serveur et en base, jamais ici.

export type MapDataError = 'invalid_code' | 'not_configured' | 'too_many_attempts' | 'network'

export const MAP_DATA_ERRORS: Record<MapDataError, string> = {
  invalid_code: 'Code incorrect.',
  not_configured: 'Le code d\'accès n\'a pas encore été défini par un administrateur.',
  too_many_attempts: 'Trop d\'essais. Réessayez dans un quart d\'heure.',
  network: 'Impossible de joindre le serveur. Vérifiez votre connexion.',
}

// Condition écrite en entier (pas via une variable importée) pour que le build de production retire le mode démo
const DEMO = import.meta.env.VITE_DEMO === '1'
const demo = () => import('./demo')

/** Erreur renvoyée par l'API : le message à afficher et, pour une erreur SQL, son code. */
export class ApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(0, MAP_DATA_ERRORS.network)
  }
  const payload = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, payload?.error ?? `Erreur ${res.status}`, payload?.code)
  return payload as T
}

const seg = (value: string) => encodeURIComponent(value)

type MapDataResponse = ({ ok: true } & MapData) | { ok: false; error: MapDataError }

/** Lecture de la carte : avec le code, ou sans code pour une personne connectée par le portail. */
export async function fetchMapData(code: string | null): Promise<{ data: MapData } | { error: MapDataError }> {
  if (DEMO) return { data: await (await import('./demo')).demoMapData() }
  let res: MapDataResponse
  try {
    res = await api<MapDataResponse>('POST', '/carte', { code })
  } catch {
    return { error: 'network' }
  }
  if (!res.ok) return { error: res.error }
  return {
    data: {
      admin: res.admin,
      chiffres: res.chiffres,
      manager: res.manager,
      commerciaux: res.commerciaux,
      managers: res.managers ?? [],
      settings: res.settings,
      structures: res.structures ?? [],
      affectations: res.affectations,
      objectifs: res.objectifs,
      a_recruter: res.a_recruter,
      updated_at: res.updated_at,
    },
  }
}

/** Traduit les erreurs de contraintes de la base en messages lisibles. */
function fail(error: unknown): never {
  if (error instanceof ApiError) {
    if (error.code === '23505') throw new Error('Un commercial porte déjà ce nom.')
    if (error.code === '23514' && /telephone|email/.test(error.message)) throw new Error('Téléphone ou e-mail illisible.')
  }
  throw error instanceof Error ? error : new Error('Erreur inconnue')
}

const guarded = async <T>(call: () => Promise<T>, onError: (error: unknown) => never = fail): Promise<T> => {
  try {
    return await call()
  } catch (error) {
    onError(error)
  }
}

export async function saveCommercial(p: CommercialPayload): Promise<string> {
  if (DEMO) return (await demo()).demoSave(p)
  return guarded(async () => (await api<{ id: string }>('POST', '/admin/commerciaux', p)).id)
}

export async function deleteCommercial(id: string): Promise<void> {
  if (DEMO) return (await demo()).demoDelete(id)
  await guarded(() => api('DELETE', `/admin/commerciaux/${seg(id)}`))
}

// ---------- Managers ----------

export async function createManager(m: Pick<Manager, 'nom' | 'couleur'>): Promise<void> {
  if (DEMO) return (await demo()).demoCreateManager(m)
  await guarded(
    () => api('POST', '/admin/managers', { nom: m.nom.trim(), couleur: m.couleur }),
    (error) => {
      if (error instanceof ApiError && error.code === '23505') throw new Error('Un manager porte déjà ce nom.')
      fail(error)
    },
  )
}

export async function setManagerColor(nom: string, couleur: string): Promise<void> {
  if (DEMO) return (await demo()).demoSetManagerColor(nom, couleur)
  await guarded(() => api('PATCH', `/admin/managers/${seg(nom)}`, { couleur }))
}

/** Coordonnées, compte GD One, fiche de commercial (null pour effacer) et structures d'un manager : seules les clés envoyées changent. */
export async function updateManager(nom: string, patch: Partial<Pick<Manager, 'telephone' | 'email' | 'compte' | 'commercial_id' | 'structures'>>): Promise<void> {
  if (DEMO) return (await demo()).demoUpdateManager(nom, patch)
  await guarded(
    () => api('PATCH', `/admin/managers/${seg(nom)}`, patch),
    (error) => {
      if (error instanceof ApiError && error.code === '23514') throw new Error('Téléphone ou e-mail illisible.')
      if (error instanceof ApiError && error.code === '23505') throw new Error(/commercial/.test(error.message) ? 'Cette fiche est déjà celle d\'un autre manager.' : 'Ce compte GD One est déjà relié à un autre manager.')
      fail(error)
    },
  )
}

/** Renomme (ou fusionne si le nouveau nom existe déjà) ; les commerciaux suivent. */
export async function renameManager(oldName: string, newName: string): Promise<void> {
  if (DEMO) return (await demo()).demoRenameManager(oldName, newName)
  await guarded(() => api('POST', `/admin/managers/${seg(oldName)}/renommer`, { nom: newName }))
}

/** Supprime le manager ; ses commerciaux se retrouvent sans manager à ce niveau. */
export async function deleteManager(nom: string): Promise<void> {
  if (DEMO) return (await demo()).demoDeleteManager(nom)
  await guarded(() => api('DELETE', `/admin/managers/${seg(nom)}`))
}

// ---------- Structures ----------

function structureFail(error: unknown): never {
  if (error instanceof ApiError && error.code === '23505') throw new Error('Une structure porte déjà ce code.')
  if (error instanceof ApiError && error.code === '23514') {
    throw new Error('Code invalide : 2 à 6 lettres majuscules ou chiffres, en commençant par une lettre.')
  }
  fail(error)
}

export async function createStructure(s: StructureDef): Promise<void> {
  if (DEMO) return (await demo()).demoCreateStructure(s)
  await guarded(() => api('POST', '/admin/structures', s), structureFail)
}

/** Modifie le nom et, si besoin, le code (zones, objectifs et commerciaux suivent). */
export async function updateStructure(code: string, patch: { code: string; nom: string }): Promise<void> {
  if (DEMO) return (await demo()).demoUpdateStructure(code, patch)
  await guarded(() => api('PATCH', `/admin/structures/${seg(code)}`, patch), structureFail)
}

/** Supprime la structure avec ses zones et ses CA/objectifs. */
export async function deleteStructure(code: string): Promise<void> {
  if (DEMO) return (await demo()).demoDeleteStructure(code)
  await guarded(() => api('DELETE', `/admin/structures/${seg(code)}`), structureFail)
}

export async function reorderStructures(codes: string[]): Promise<void> {
  if (DEMO) return (await demo()).demoReorderStructures(codes)
  await guarded(() => api('PUT', '/admin/ordre-structures', { codes }), structureFail)
}

/** Mode d'affichage des zones partagées proposé par défaut à tout le monde. */
export async function setDefaultSharedMode(mode: DisplaySettings['default_shared_mode']): Promise<void> {
  if (DEMO) return (await demo()).demoSetDefaultSharedMode(mode)
  await guarded(() => api('PUT', '/admin/affichage', { mode }))
}

export interface AccessStatus {
  configured: boolean
  updated_at: string | null
  updated_by: string | null
}

export async function getAccessStatus(): Promise<AccessStatus> {
  if (DEMO) return { configured: true, updated_at: null, updated_by: null }
  return guarded(() => api<AccessStatus>('GET', '/admin/code'))
}

export async function setAccessCode(code: string): Promise<void> {
  if (DEMO) throw new Error('Indisponible en mode démo.')
  await guarded(() => api('PUT', '/admin/code', { code }))
}

/** Manager 1 et Manager 2, pour toute la carte (il en reste toujours un). */
export async function setManagersActifs(manager1: boolean, manager2: boolean): Promise<void> {
  if (DEMO) return (await demo()).demoSetManagersActifs(manager1, manager2)
  await guarded(() => api('PUT', '/admin/managers-actifs', { manager1, manager2 }))
}

// ---------- Manager : son équipe (D-010) ----------

/** Zones (dans ses structures, en entier) et chiffres (les seules lignes qui changent) d'un commercial de son équipe. */
export async function saveEquipe(id: string, patch: { affectations?: ZoneAssignment[]; objectifs?: Omit<Objectif, 'commercial_id'>[] }): Promise<void> {
  if (DEMO) return (await demo()).demoSaveEquipe(id, patch)
  await guarded(() => api('PUT', `/equipe/${seg(id)}`, patch))
}

// ---------- Départements à recruter (D-011) ----------

export async function setRecrutement(structure: string, zones: { zone_code: string; priorite: Priorite | null; secteur: string | null }[]): Promise<void> {
  if (DEMO) return (await demo()).demoSetRecrutement(structure, zones)
  await guarded(() => api('PUT', `/admin/recrutement/${seg(structure)}`, { zones }))
}

/** Supprime des fiches « À recruter » : leurs départements vides prennent leur nom pour secteur. */
export async function convertirARecruter(ids: string[]): Promise<{ fiches: number; zones: number }> {
  if (DEMO) throw new Error('Indisponible en mode démo.')
  return guarded(() => api<{ fiches: number; zones: number }>('POST', '/admin/recrutement/convertir', { ids }))
}

// ---------- Journal (D-010) ----------

export interface JournalPageData {
  lignes: JournalLine[]
  /** Nombre d'enregistrements, toutes pages confondues. */
  total: number
  page: number
  taille: number
}

/** Une page d'enregistrements, du plus récent au plus ancien ; la recherche porte sur tout le journal. */
export async function fetchJournal(page: number, recherche = ''): Promise<JournalPageData> {
  if (DEMO) return { lignes: [], total: 0, page: 1, taille: 20 }
  const query = new URLSearchParams({ page: String(page), ...(recherche && { recherche }) })
  return guarded(() => api('GET', `/journal?${query}`))
}

// ---------- Rôles (D-010) : les admins ici, les managers par leur compte (onglet Managers) ----------

export interface RoleEntry {
  email: string
  role: 'admin'
  created_at: string
  created_by: string | null
  /** Nom transmis par le portail, une fois la personne venue au moins une fois. */
  name: string | null
  last_sign_in_at: string | null
}

export interface KnownUser {
  email: string
  name: string
  /** Accès à la carte sur le portail (par une organisation ou par elle-même), lu à sa dernière connexion. */
  has_access: boolean
  last_sign_in_at: string | null
}

export async function listAccess(): Promise<{ roles: RoleEntry[]; users: KnownUser[] }> {
  if (DEMO) {
    return {
      roles: [{ email: 'demo@exemple.fr', role: 'admin', created_at: new Date().toISOString(), created_by: null, name: 'Démo', last_sign_in_at: null }],
      users: [],
    }
  }
  return guarded(() => api('GET', '/admin/acces'))
}

/** Nomme un admin. */
export async function addAdmin(email: string): Promise<void> {
  if (DEMO) throw new Error('Indisponible en mode démo.')
  await guarded(
    () => api('PUT', `/admin/acces/${seg(email.trim().toLowerCase())}`, { role: 'admin' }),
    (error) => {
      if (error instanceof ApiError && error.code === '23514') throw new Error('Adresse e-mail illisible.')
      fail(error)
    },
  )
}

export async function removeAdmin(email: string): Promise<void> {
  if (DEMO) throw new Error('Indisponible en mode démo.')
  await guarded(() => api('DELETE', `/admin/acces/${seg(email)}`))
}

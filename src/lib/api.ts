import type { StructureDef } from './structures'
import type { CommercialPayload, DisplaySettings, Manager, MapData } from './types'

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
      commerciaux: res.commerciaux,
      managers: res.managers ?? [],
      settings: res.settings,
      structures: res.structures ?? [],
      affectations: res.affectations,
      objectifs: res.objectifs,
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

export async function applyImport(items: CommercialPayload[], deleteIds: string[]) {
  if (DEMO) return (await demo()).demoApplyImport(items, deleteIds)
  return guarded(() => api<{ saved: number; deleted: number }>('POST', '/admin/import', { items, deleteIds }))
}

// ---------- Managers ----------

export async function createManager(m: Manager): Promise<void> {
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

/** Téléphone et e-mail d'un manager (null pour effacer). */
export async function setManagerContact(nom: string, contact: { telephone: string | null; email: string | null }): Promise<void> {
  if (DEMO) return (await demo()).demoSetManagerContact(nom, contact)
  await guarded(
    () => api('PATCH', `/admin/managers/${seg(nom)}`, contact),
    (error) => {
      if (error instanceof ApiError && error.code === '23514') throw new Error('Téléphone ou e-mail illisible.')
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

// ---------- Rôles (D-002) ----------

export type Role = 'admin' | 'responsable'

export interface RoleEntry {
  email: string
  role: Role
  managers: string[]
  created_at: string
  created_by: string | null
  /** Nom transmis par le portail, une fois la personne venue au moins une fois. */
  name: string | null
  last_sign_in_at: string | null
}

export interface KnownUser {
  email: string
  name: string
  /** Droit d'usage `gd-map` sur le portail, lu à sa dernière connexion. */
  has_access: boolean
  last_sign_in_at: string | null
}

export async function listAccess(): Promise<{ roles: RoleEntry[]; users: KnownUser[] }> {
  if (DEMO) {
    return {
      roles: [{ email: 'demo@exemple.fr', role: 'admin', managers: [], created_at: new Date().toISOString(), created_by: null, name: 'Démo', last_sign_in_at: null }],
      users: [],
    }
  }
  return guarded(() => api('GET', '/admin/acces'))
}

export async function setRole(email: string, role: Role): Promise<void> {
  if (DEMO) throw new Error('Indisponible en mode démo.')
  await guarded(
    () => api('PUT', `/admin/acces/${seg(email.trim().toLowerCase())}`, { role }),
    (error) => {
      if (error instanceof ApiError && error.code === '23514') throw new Error('Adresse e-mail illisible.')
      fail(error)
    },
  )
}

export async function removeRole(email: string): Promise<void> {
  if (DEMO) throw new Error('Indisponible en mode démo.')
  await guarded(() => api('DELETE', `/admin/acces/${seg(email)}`))
}

import { requireSupabase } from './supabase'
import type { CommercialPayload, MapData } from './types'

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

type MapDataResponse = ({ ok: true } & MapData) | { ok: false; error: MapDataError }

/** Lecture de la carte : avec le code, ou sans code pour un admin connecté. */
export async function fetchMapData(code: string | null): Promise<{ data: MapData } | { error: MapDataError }> {
  if (DEMO) return { data: await (await import('./demo')).demoMapData() }
  const { data, error } = await requireSupabase().rpc('get_map_data', { p_code: code })
  if (error) return { error: 'network' }
  const res = data as MapDataResponse
  if (!res.ok) return { error: res.error }
  return {
    data: {
      admin: res.admin,
      commerciaux: res.commerciaux,
      affectations: res.affectations,
      objectifs: res.objectifs,
      updated_at: res.updated_at,
    },
  }
}

function fail(error: { message: string; code?: string } | null): never {
  if (error?.code === '23505') throw new Error('Un commercial porte déjà ce nom.')
  throw new Error(error?.message ?? 'Erreur inconnue')
}

export async function checkIsAdmin(): Promise<boolean> {
  if (DEMO) return true
  const { data, error } = await requireSupabase().rpc('is_admin')
  if (error) return false
  return data === true
}

export async function saveCommercial(p: CommercialPayload): Promise<string> {
  if (DEMO) return (await demo()).demoSave(p)
  const { data, error } = await requireSupabase().rpc('save_commercial', { p })
  if (error) fail(error)
  return data as string
}

export async function deleteCommercial(id: string): Promise<void> {
  if (DEMO) return (await demo()).demoDelete(id)
  const { error } = await requireSupabase().from('commerciaux').delete().eq('id', id)
  if (error) fail(error)
}

export async function applyImport(items: CommercialPayload[], deleteIds: string[]) {
  if (DEMO) return (await demo()).demoApplyImport(items, deleteIds)
  const { data, error } = await requireSupabase().rpc('apply_import', { p_items: items, p_delete_ids: deleteIds })
  if (error) fail(error)
  return data as { saved: number; deleted: number }
}

export interface AccessStatus {
  configured: boolean
  updated_at: string | null
  updated_by: string | null
}

export async function getAccessStatus(): Promise<AccessStatus> {
  if (DEMO) return { configured: true, updated_at: null, updated_by: null }
  const { data, error } = await requireSupabase().rpc('get_access_status')
  if (error) fail(error)
  return data as AccessStatus
}

export async function setAccessCode(code: string): Promise<void> {
  if (DEMO) throw new Error('Indisponible en mode démo.')
  const { error } = await requireSupabase().rpc('set_access_code', { p_code: code })
  if (error) fail(error)
}

// Gestion des comptes admins : Edge Function admin-users (clé secrète côté serveur uniquement)
export interface AdminUser {
  user_id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
}

type AdminAction =
  | { action: 'list' }
  | { action: 'create'; email: string; password: string }
  | { action: 'set_password'; user_id: string; password: string }
  | { action: 'remove'; user_id: string }

export async function adminUsers<T = unknown>(body: AdminAction): Promise<T> {
  if (DEMO) {
    if (body.action === 'list') return [{ user_id: 'demo', email: 'demo@exemple.fr', created_at: new Date().toISOString(), last_sign_in_at: null }] as T
    throw new Error('Indisponible en mode démo.')
  }
  const { data, error } = await requireSupabase().functions.invoke('admin-users', { body })
  if (error) {
    let message = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      const payload = await ctx.json().catch(() => null)
      if (payload?.error) message = payload.error
    }
    if (/Failed to send a request|not found|404/i.test(message)) {
      message = 'La fonction admin-users n\'est pas déployée (voir SUPABASE_SETUP.md, étape 5).'
    }
    throw new Error(message)
  }
  return data as T
}

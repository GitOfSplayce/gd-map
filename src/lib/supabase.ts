import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined

export const isDemo = import.meta.env.VITE_DEMO === '1'

export const isConfigured = isDemo || Boolean(url && key)

/** null tant que .env.local (ou les variables GitHub Actions) ne sont pas renseignés. */
export const supabase: SupabaseClient | null = url && key && !isDemo ? createClient(url, key) : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase n\'est pas configuré : renseignez VITE_SUPABASE_URL et VITE_SUPABASE_PUBLISHABLE_KEY')
  return supabase
}

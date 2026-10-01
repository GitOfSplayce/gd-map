// Gestion des comptes admins depuis /admin : lister, créer, changer un mot de passe, retirer.
// La création de comptes nécessite la clé secrète : elle reste ici, côté serveur.
// Déployée sans vérification JWT automatique (config.toml) : l'appelant est vérifié ci-dessous.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Nouvelles clés (dictionnaire JSON) en priorité, puis clé service_role historique
function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>
    const first = Object.values(keys)[0]
    if (first) return first
  } catch {
    // variable absente ou illisible
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
}

const MIN_PASSWORD = 10

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Non connecté' }, 401)
  const { data: auth, error: authError } = await sb.auth.getUser(token)
  if (authError || !auth.user) return json({ error: 'Session invalide, reconnectez-vous' }, 401)
  const caller = auth.user

  const { data: isAdmin } = await sb.from('admins').select('user_id').eq('user_id', caller.id).maybeSingle()
  if (!isAdmin) return json({ error: 'Accès réservé aux admins' }, 403)

  const body = await req.json().catch(() => ({}))

  switch (body.action) {
    case 'list': {
      const { data: rows, error } = await sb.from('admins').select('user_id, email, created_at').order('created_at')
      if (error) return json({ error: error.message }, 500)
      const users = await Promise.all(
        rows.map(async (r) => {
          const { data } = await sb.auth.admin.getUserById(r.user_id)
          return { ...r, last_sign_in_at: data.user?.last_sign_in_at ?? null }
        }),
      )
      return json(users)
    }

    case 'create': {
      const email = String(body.email ?? '').trim().toLowerCase()
      const password = String(body.password ?? '')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Adresse e-mail invalide' }, 400)
      if (password.length < MIN_PASSWORD) {
        return json({ error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères` }, 400)
      }

      let userId: string | undefined
      let existing = false
      const { data: created, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true })
      if (created.user) {
        userId = created.user.id
      } else {
        // Compte déjà existant (créé depuis le dashboard par exemple) : on lui donne simplement les droits
        for (let page = 1; !userId && page <= 20; page++) {
          const { data } = await sb.auth.admin.listUsers({ page, perPage: 200 })
          userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id
          if (data.users.length < 200) break
        }
        if (!userId) return json({ error: error?.message ?? 'Création du compte impossible' }, 400)
        existing = true
      }

      const { error: insertError } = await sb.from('admins').upsert({ user_id: userId, email }, { onConflict: 'user_id' })
      if (insertError) return json({ error: insertError.message }, 500)
      return json({ user_id: userId, existing })
    }

    case 'set_password': {
      const password = String(body.password ?? '')
      if (password.length < MIN_PASSWORD) {
        return json({ error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères` }, 400)
      }
      const { data: target } = await sb.from('admins').select('user_id').eq('user_id', body.user_id).maybeSingle()
      if (!target) return json({ error: 'Cet utilisateur n\'est pas admin' }, 404)
      const { error } = await sb.auth.admin.updateUserById(body.user_id, { password })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    case 'remove': {
      if (body.user_id === caller.id) return json({ error: 'Vous ne pouvez pas retirer votre propre accès' }, 400)
      const { count } = await sb.from('admins').select('user_id', { count: 'exact', head: true })
      if ((count ?? 0) <= 1) return json({ error: 'Il doit rester au moins un admin' }, 400)
      const { error } = await sb.auth.admin.deleteUser(body.user_id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    default:
      return json({ error: 'Action inconnue' }, 400)
  }
})

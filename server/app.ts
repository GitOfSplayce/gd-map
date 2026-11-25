import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { compress } from 'hono/compress'
import { secureHeaders } from 'hono/secure-headers'
import type { Db, Queryable, Visitor } from './db.ts'

// L'API de la carte. Chaque route fait une requête SQL avec les droits du visiteur (server/db.ts) :
// les règles RLS et les fonctions SQL, testées dans db/tests, décident de ce qui est permis. Les
// routes /api/admin/* vérifient en plus le rôle admin, pour répondre 401 ou 403 plutôt qu'une erreur SQL.
// Rôles (D-010) : la carte se lit avec le code ; seuls les admins (`acces`) et les managers reliés à leur
// compte (`managers.compte`) l'ouvrent par le portail.

export interface SessionUser {
  id: string
  email: string
  name: string
  image: string | null
  /** Le portail ouvre la carte à la personne, par une organisation ou par elle-même (nécessaire, pas suffisant : D-010). */
  hasAccess: boolean
}

export interface AppDependencies {
  db: Db
  /** La personne connectée, d'après le cookie de session (ou la session locale de développement). */
  getUser: (headers: Headers) => Promise<SessionUser | null>
  /** Routes de Better Auth : connexion par le portail, retour, déconnexion. */
  authHandler: (request: Request) => Promise<Response>
  /** Adresse de la connexion TCP, quand aucun proxy n'a écrit X-Forwarded-For. */
  remoteAddress?: (c: Context) => string | undefined
  /** Adresse du portail, pour envoyer vers son compte (mot de passe, passkeys, double authentification). */
  portalUrl?: string | null
  /** Adresse publique de la carte : origine des requêtes qu'elle adresse elle-même à Better Auth. */
  baseUrl: string
}

type Env = { Variables: { user: SessionUser | null; visitor: Visitor } }

/** Erreur SQL → réponse HTTP. Le message part tel quel : il porte les règles (« Code invalide… »). */
const SQL_STATUS: Record<string, 400 | 403 | 404 | 409> = {
  '42501': 403, // droits insuffisants, règle RLS
  '23505': 409, // doublon
  '23503': 400, // référence inconnue (zone, structure)
  '23514': 400, // contrainte de format
  '22023': 400, // valeur refusée par une fonction
  '22P02': 400, // texte illisible (uuid, nombre)
  P0001: 400,
  P0002: 404,
}

class HttpError extends Error {
  status: 400 | 401 | 403 | 404
  constructor(status: 400 | 401 | 403 | 404, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * IP du visiteur pour la limite d'essais du code. Traefik réécrit X-Forwarded-For avec l'adresse qu'il
 * voit (vérifié le 2026-10-26) : sa première valeur est fiable tant que le conteneur n'est joignable
 * que par lui (D-004).
 */
export function clientIp(forwardedFor: string | undefined, remote: string | undefined) {
  const first = forwardedFor?.split(',')[0]?.trim()
  return first || remote || 'inconnue'
}

/**
 * Chemin de retour après la connexion : un chemin de la carte, rien d'autre. `//exemple.fr` ou une
 * adresse complète renverraient ailleurs (redirection ouverte) : on revient alors à l'accueil.
 */
export function returnPath(value: string | undefined) {
  return value && /^\/(?![/\\])/.test(value) ? value : '/'
}

/** Le chemin, avec `connexion=echec` : l'écran dit que la connexion par le portail n'a pas abouti. */
export const failedSignInPath = (path: string) => `${path}${path.includes('?') ? '&' : '?'}connexion=echec`

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Requête illisible')
  return body as Record<string, unknown>
}

const text = (value: unknown, field: string) => {
  if (typeof value !== 'string') throw new HttpError(400, `Champ manquant : ${field}`)
  return value
}

const optionalText = (value: unknown, field: string) => {
  if (value === null) return null
  return text(value, field)
}

export function createApp(deps: AppDependencies) {
  const app = new Hono<Env>()

  app.use('*', secureHeaders())
  // Contours de la carte (≈ 600 Ko de GeoJSON), scripts et réponses de l'API : compressés à l'envoi
  app.use('*', compress())

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status)
    const sqlCode = (error as { code?: unknown }).code
    if (typeof sqlCode === 'string' && SQL_STATUS[sqlCode]) {
      return c.json({ error: error.message, code: sqlCode }, SQL_STATUS[sqlCode])
    }
    console.error('[api]', error)
    return c.json({ error: 'Erreur du serveur' }, 500)
  })

  app.on(['GET', 'POST'], '/api/auth/*', (c) => deps.authHandler(c.req.raw))

  app.get('/api/health', async (c) => {
    try {
      await deps.db.query('select 1')
      return c.json({ app: 'up', db: 'up' })
    } catch {
      return c.json({ app: 'up', db: 'down' }, 503)
    }
  })

  // Les plus grosses requêtes (toutes les zones d'un commercial, un journal de saisie) tiennent largement dans 1 Mo
  app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: 'Requête trop volumineuse' }, 413) }))

  app.use('/api/*', async (c, next) => {
    const user = await deps.getUser(c.req.raw.headers)
    c.set('user', user)
    c.set('visitor', {
      userId: user?.id ?? null,
      ip: clientIp(c.req.header('x-forwarded-for'), deps.remoteAddress?.(c)),
    })
    await next()
  })

  const as = <T>(c: Context<Env>, fn: (q: Queryable) => Promise<T>) => deps.db.as(c.get('visitor'), fn)
  const one = async <T>(c: Context<Env>, sql: string, params: unknown[] = []) =>
    as(c, async (q) => (await q.query<{ r: T }>(sql, params)).rows[0]?.r as T)

  /**
   * Qui est connecté, et ce qu'il peut faire (D-010) : admin, manager, ou rien. Sans rôle (ou sans
   * accès sur le portail), la carte s'ouvre avec le code, comme pour tout le monde.
   */
  app.get('/api/moi', async (c) => {
    const user = c.get('user')
    const portalUrl = deps.portalUrl ?? null
    if (!user) return c.json({ user: null, role: null, portalUrl })
    const role = await one<'admin' | 'manager' | null>(c, 'select public.map_role() as r')
    return c.json({
      user: { email: user.email, name: user.name, image: user.image },
      role: role ?? null,
      portalUrl,
    })
  })

  /**
   * Entrée par le portail (D-007) : la tuile de GD One mène ici, et l'on arrive sur la carte déjà
   * connecté. Déjà venu, on y va tout droit ; sinon, on part vers le portail par la même route que le
   * bouton de la carte (sign-in/social de Better Auth), dont on garde le cookie d'état, puis on revient
   * sur `retour`. En cas d'échec, l'écran le dit (`?connexion=echec`) et le code d'accès reste possible.
   */
  app.get('/api/connexion', async (c) => {
    const back = returnPath(c.req.query('retour'))
    const user = c.get('user')
    if (user?.hasAccess) return c.redirect(back, 302)

    const start = await deps.authHandler(
      new Request(`${deps.baseUrl}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: new URL(deps.baseUrl).origin, Cookie: c.req.header('cookie') ?? '' },
        body: JSON.stringify({ provider: 'gdcom', callbackURL: back, errorCallbackURL: failedSignInPath(back) }),
      }),
    )
    const target = start.ok ? ((await start.json().catch(() => null)) as { url?: unknown } | null)?.url : undefined
    if (typeof target !== 'string') {
      console.error('[connexion] départ vers le portail impossible', start.status)
      return c.redirect(failedSignInPath(back), 302)
    }
    const redirect = new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } })
    for (const cookie of start.headers.getSetCookie()) redirect.headers.append('Set-Cookie', cookie)
    return redirect
  })

  // POST et non GET : le code d'accès ne doit pas finir dans les journaux d'accès de Traefik
  app.post('/api/carte', async (c) => {
    const body = await jsonBody(c)
    const code = body.code == null ? null : text(body.code, 'code')
    return c.json(await one(c, 'select public.get_map_data($1) as r', [code]))
  })

  // ---------- Manager : les départements, le CA et les objectifs de son équipe (D-010) ----------

  // Connecté, sinon 401 ; le rôle, l'équipe et les départements libres, la base les vérifie (42501 → 403).
  const signedIn = (c: Context<Env>) => {
    if (!c.get('user')) throw new HttpError(401, 'Non connecté')
  }

  /** `affectations` : ses zones dans les structures du manager, en entier ; `objectifs` : les seules lignes qui changent. */
  app.put('/api/equipe/:id', async (c) => {
    signedIn(c)
    const body = await jsonBody(c)
    const patch: Record<string, unknown> = {}
    for (const key of ['affectations', 'objectifs'] as const) {
      if (!(key in body)) continue
      if (!Array.isArray(body[key])) throw new HttpError(400, key === 'affectations' ? 'Liste de zones illisible' : 'Liste de CA et objectifs illisible')
      patch[key] = body[key]
    }
    if (!Object.keys(patch).length) throw new HttpError(400, 'Rien à modifier')
    await as(c, (q) => q.query('select public.save_equipe($1::uuid, $2::jsonb)', [c.req.param('id'), JSON.stringify(patch)]))
    return c.json({ ok: true })
  })

  // ---------- Journal : tout pour un admin, son équipe pour un manager ----------

  app.get('/api/journal', async (c) => {
    signedIn(c)
    const avant = c.req.query('avant')
    if (avant !== undefined && !/^\d{1,18}$/.test(avant)) throw new HttpError(400, 'Page illisible')
    const commercial = c.req.query('commercial') ?? null
    return c.json(await one(c, 'select public.get_journal($1::bigint, 200, $2::uuid) as r', [avant ?? null, commercial]))
  })

  app.use('/api/admin/*', async (c, next) => {
    if (!c.get('user')) throw new HttpError(401, 'Non connecté')
    if (!(await one<boolean>(c, 'select public.is_admin() as r'))) throw new HttpError(403, 'Accès réservé aux admins')
    await next()
  })

  // ---------- Commerciaux ----------

  app.post('/api/admin/commerciaux', async (c) => {
    const id = await one<string>(c, 'select public.save_commercial($1::jsonb) as r', [JSON.stringify(await jsonBody(c))])
    return c.json({ id })
  })

  app.delete('/api/admin/commerciaux/:id', async (c) => {
    await as(c, (q) => q.query('delete from public.commerciaux where id = $1', [c.req.param('id')]))
    return c.json({ ok: true })
  })

  // ---------- Départements à recruter (D-011) ----------

  /** Priorité (1 à 3) et secteur de départements vides ; ni l'un ni l'autre : à recruter, sans priorité. */
  app.put('/api/admin/recrutement/:structure', async (c) => {
    const body = await jsonBody(c)
    if (!Array.isArray(body.zones)) throw new HttpError(400, 'Liste de départements illisible')
    await as(c, (q) => q.query('select public.set_recrutement($1, $2::jsonb)', [c.req.param('structure'), JSON.stringify(body.zones)]))
    return c.json({ ok: true })
  })

  /** Supprime des fiches « À recruter » ; leurs départements vides prennent leur nom pour secteur. */
  app.post('/api/admin/recrutement/convertir', async (c) => {
    const body = await jsonBody(c)
    if (!Array.isArray(body.ids) || !body.ids.every((id) => typeof id === 'string')) throw new HttpError(400, 'Liste de fiches illisible')
    return c.json(await one(c, 'select public.convertir_a_recruter($1::uuid[]) as r', [body.ids]))
  })

  // ---------- Managers ----------

  app.post('/api/admin/managers', async (c) => {
    const body = await jsonBody(c)
    await as(c, (q) =>
      q.query('insert into public.managers (nom, couleur) values (btrim($1), $2)', [text(body.nom, 'nom'), optionalText(body.couleur ?? null, 'couleur')]),
    )
    return c.json({ ok: true })
  })

  /** Couleur, coordonnées, compte GD One, structures : seules les clés envoyées changent. */
  app.patch('/api/admin/managers/:nom', async (c) => {
    const body = await jsonBody(c)
    const fields = (['couleur', 'telephone', 'email', 'compte', 'structures'] as const).filter((key) => key in body)
    if (!fields.length) throw new HttpError(400, 'Rien à modifier')
    const values = fields.map((key) => {
      if (key !== 'structures') {
        const value = optionalText(body[key], key)
        return key === 'compte' ? value?.trim().toLowerCase() || null : value
      }
      if (!Array.isArray(body.structures) || !body.structures.every((s) => typeof s === 'string')) throw new HttpError(400, 'Liste de structures illisible')
      return body.structures
    })
    const sets = fields.map((key, i) => `${key} = $${i + 2}`).join(', ')
    await as(c, (q) => q.query(`update public.managers set ${sets} where nom = $1`, [c.req.param('nom'), ...values]))
    return c.json({ ok: true })
  })

  /** Renomme, ou fusionne si le nouveau nom existe déjà ; les commerciaux suivent. */
  app.post('/api/admin/managers/:nom/renommer', async (c) => {
    const body = await jsonBody(c)
    await as(c, (q) => q.query('select public.rename_manager($1, $2)', [c.req.param('nom'), text(body.nom, 'nom')]))
    return c.json({ ok: true })
  })

  app.delete('/api/admin/managers/:nom', async (c) => {
    await as(c, (q) => q.query('delete from public.managers where nom = $1', [c.req.param('nom')]))
    return c.json({ ok: true })
  })

  // ---------- Structures ----------

  app.post('/api/admin/structures', async (c) => {
    const body = await jsonBody(c)
    const ordre = typeof body.ordre === 'number' ? body.ordre : null
    await as(c, (q) =>
      q.query('insert into public.structures (code, nom, ordre) values ($1, $2, coalesce($3, 0))', [text(body.code, 'code'), text(body.nom, 'nom'), ordre]),
    )
    return c.json({ ok: true })
  })

  app.patch('/api/admin/structures/:code', async (c) => {
    const body = await jsonBody(c)
    await as(c, (q) =>
      q.query('update public.structures set code = $2, nom = $3 where code = $1', [c.req.param('code'), text(body.code, 'code'), text(body.nom, 'nom')]),
    )
    return c.json({ ok: true })
  })

  app.delete('/api/admin/structures/:code', async (c) => {
    await as(c, (q) => q.query('delete from public.structures where code = $1', [c.req.param('code')]))
    return c.json({ ok: true })
  })

  app.put('/api/admin/ordre-structures', async (c) => {
    const body = await jsonBody(c)
    if (!Array.isArray(body.codes) || !body.codes.every((code) => typeof code === 'string')) throw new HttpError(400, 'Ordre illisible')
    await as(c, (q) => q.query('select public.reorder_structures($1::text[])', [body.codes]))
    return c.json({ ok: true })
  })

  // ---------- Réglages ----------

  app.put('/api/admin/affichage', async (c) => {
    const body = await jsonBody(c)
    await as(c, (q) => q.query('select public.set_default_shared_mode($1)', [text(body.mode, 'mode')]))
    return c.json({ ok: true })
  })

  /** Manager 1 et Manager 2, pour toute la carte : il en reste toujours un. */
  app.put('/api/admin/managers-actifs', async (c) => {
    const body = await jsonBody(c)
    if (typeof body.manager1 !== 'boolean' || typeof body.manager2 !== 'boolean') throw new HttpError(400, 'Réglage illisible')
    await as(c, (q) => q.query('select public.set_managers_actifs($1, $2)', [body.manager1, body.manager2]))
    return c.json({ ok: true })
  })

  app.get('/api/admin/code', async (c) => c.json(await one(c, 'select public.get_access_status() as r')))

  app.put('/api/admin/code', async (c) => {
    const body = await jsonBody(c)
    await as(c, (q) => q.query('select public.set_access_code($1)', [text(body.code, 'code')]))
    return c.json({ ok: true })
  })

  // ---------- Rôles ----------

  app.get('/api/admin/acces', async (c) => c.json(await one(c, 'select public.list_acces() as r')))

  /** Nomme un admin. Un manager, lui, se relie à son compte dans l'onglet Managers. Son propre rôle ne se change pas (règle RLS). */
  app.put('/api/admin/acces/:email', async (c) => {
    const body = await jsonBody(c)
    const role = text(body.role, 'role')
    if (c.req.param('email').trim().toLowerCase() === c.get('user')?.email.toLowerCase()) {
      throw new HttpError(400, 'Vous ne pouvez pas changer votre propre rôle')
    }
    const rows = await as(c, async (q) => {
      const { rows } = await q.query<{ email: string }>(
        `insert into public.acces (email, role, created_by) values (lower(btrim($1)), $2, public.current_email())
         on conflict (email) do update set role = excluded.role
         returning email`,
        [c.req.param('email'), role],
      )
      return rows
    })
    return c.json({ email: rows[0]?.email })
  })

  app.delete('/api/admin/acces/:email', async (c) => {
    const email = c.req.param('email').trim().toLowerCase()
    const removed = await as(c, async (q) => {
      const { rows } = await q.query('delete from public.acces where email = $1 returning email', [email])
      return rows.length
    })
    if (!removed) {
      if (email === c.get('user')?.email.toLowerCase()) throw new HttpError(400, 'Vous ne pouvez pas retirer votre propre rôle')
      throw new HttpError(404, 'Aucun rôle pour cette adresse')
    }
    return c.json({ ok: true })
  })

  app.all('/api/*', (c) => c.json({ error: 'Introuvable' }, 404))

  return app
}

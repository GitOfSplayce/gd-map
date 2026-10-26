// Serveur de la carte (D-003) : l'API, la connexion par le portail et le site construit par Vite.
// Au démarrage : migrations, premiers admins, puis écoute. Lancé tel quel par Node (types effacés).
import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { serveStatic } from '@hono/node-server/serve-static'
import { fileURLToPath } from 'node:url'
import type pg from 'pg'
import { createApp, type SessionUser } from './app.ts'
import { createAuth } from './auth.ts'
import { createPool, pgDb } from './db.ts'
import { readEnv } from './env.ts'
import { migrate } from './migrate.ts'

const env = readEnv()
const pool = createPool(env.databaseUrl)

// La base peut démarrer après le conteneur (premier déploiement, redémarrage du serveur) : on l'attend
// en le disant, plutôt que de s'arrêter et d'attendre qu'on nous relance.
for (let attempt = 1; ; attempt++) {
  try {
    await pool.query('select 1')
    break
  } catch (error) {
    if (attempt === 30) throw error
    console.warn(`[démarrage] base pas encore joignable (${(error as Error).message}), nouvel essai dans 2 s`)
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
}

await migrate(pool, fileURLToPath(new URL('../db/migrations/', import.meta.url)))

// Premiers admins (GD_MAP_ADMINS) : ajoutés s'ils n'ont pas de rôle, jamais retirés d'ici (D-002)
if (env.admins.length) {
  const { rows } = await pool.query<{ email: string }>(
    `insert into public.acces (email, role, created_by)
     select email, 'admin', 'GD_MAP_ADMINS' from unnest($1::text[]) as email
     on conflict (email) do nothing
     returning email`,
    [env.admins],
  )
  for (const { email } of rows) console.log(`[admins] ${email} ajouté depuis GD_MAP_ADMINS`)
}

const auth = createAuth({ pool, baseUrl: env.baseUrl, secret: env.authSecret, oidc: env.oidc })

/** Session locale de développement : une personne fixe, admise, sans passer par le portail. */
async function devSessionUser(db: pg.Pool, email: string): Promise<SessionUser> {
  const { rows } = await db.query<{ id: string; name: string; email: string; image: string | null }>(
    `insert into public."user" (name, email, "emailVerified", "hasAccess") values ($1, $2, true, true)
     on conflict (email) do update set "hasAccess" = true
     returning id, name, email, image`,
    [email.split('@')[0], email],
  )
  console.warn(`[dev] session locale : ${email} (GD_MAP_DEV_SESSION), sans portail`)
  return { ...rows[0], hasAccess: true }
}

const devUser = env.devSession ? await devSessionUser(pool, env.devSession) : null

const app = createApp({
  db: pgDb(pool),
  getUser: async (headers) => {
    if (devUser) return devUser
    const session = await auth.api.getSession({ headers })
    if (!session) return null
    const { user } = session
    return { id: user.id, email: user.email, name: user.name, image: user.image ?? null, hasAccess: Boolean(user.hasAccess) }
  },
  authHandler: (request) => auth.handler(request),
  remoteAddress: (c) => getConnInfo(c).remote.address,
  portalUrl: env.oidc?.issuer ?? null,
})

// Le site : fichiers versionnés par Vite gardés un an, le reste revalidé, et index.html pour toute
// adresse de l'application (/admin, /aide…).
const root = env.staticRoot
app.use(
  '/assets/*',
  serveStatic({ root, onFound: (_path, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable') }),
)
app.use(
  '*',
  serveStatic({
    root,
    onFound: (path, c) => {
      c.header('Cache-Control', path.endsWith('.html') ? 'no-cache' : 'public, max-age=3600')
      // Type inconnu de la table des types : sans lui, les contours partiraient sans compression
      if (path.endsWith('.geojson')) c.header('Content-Type', 'application/geo+json')
    },
  }),
)
app.get('*', serveStatic({ root, path: 'index.html', onFound: (_path, c) => c.header('Cache-Control', 'no-cache') }))

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`[serveur] carte sur le port ${info.port} (${env.baseUrl})`)
})

// Arrêt propre quand Dokploy remplace le conteneur
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => void pool.end().then(() => process.exit(0)))
    setTimeout(() => process.exit(0), 10_000).unref()
  })
}

// L'API de bout en bout : vraies migrations dans PGlite, vraies routes Hono ; seule la session est
// simulée (en-tête x-test-user), comme la donnerait Better Auth après la connexion par le portail.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { clientIp, createApp, type SessionUser } from './app.ts'
import { VISITOR_SETTINGS, visitorParams, type Db } from './db.ts'

const MIGRATIONS = fileURLToPath(new URL('../db/migrations/', import.meta.url))

const USERS: Record<string, SessionUser> = {
  admin: { id: '00000000-0000-0000-0000-00000000000a', email: 'admin@exemple.fr', name: 'Admin', image: null, hasAccess: true },
  reader: { id: '00000000-0000-0000-0000-00000000000b', email: 'lectrice@exemple.fr', name: 'Lectrice', image: null, hasAccess: true },
  outsider: { id: '00000000-0000-0000-0000-00000000000c', email: 'exterieur@exemple.fr', name: 'Extérieur', image: null, hasAccess: false },
}

let pglite: PGlite
let app: ReturnType<typeof createApp>

beforeAll(async () => {
  pglite = new PGlite({ extensions: { pgcrypto } })
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await pglite.exec(readFileSync(MIGRATIONS + file, 'utf8'))
  }
  for (const u of Object.values(USERS)) {
    await pglite.query(`insert into public."user" (id, name, email, "emailVerified", "hasAccess") values ($1, $2, $3, true, $4)`, [u.id, u.name, u.email, u.hasAccess])
  }
  await pglite.query(`insert into public.acces (email, role) values ('admin@exemple.fr', 'admin')`)

  const db: Db = {
    query: (text, params) => pglite.query(text, params),
    as: (visitor, fn) =>
      pglite.transaction(async (tx) => {
        await tx.query(VISITOR_SETTINGS, visitorParams(visitor))
        return fn({ query: (text, params) => tx.query(text, params) })
      }),
  }
  app = createApp({
    db,
    getUser: async (headers) => USERS[headers.get('x-test-user') ?? ''] ?? null,
    authHandler: async () => new Response('auth', { status: 418 }),
    portalUrl: 'https://portail.exemple.fr',
  })
}, 60_000)

type Who = 'anon' | keyof typeof USERS

async function call(who: Who, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await app.request(path, {
    method,
    headers: {
      ...(who === 'anon' ? {} : { 'x-test-user': who }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      'x-forwarded-for': '198.51.100.20',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> }
}

describe('adresse IP du visiteur', () => {
  it('prend la première valeur de X-Forwarded-For, sinon la connexion', () => {
    expect(clientIp('203.0.113.5, 10.0.0.2', '10.0.0.2')).toBe('203.0.113.5')
    expect(clientIp(undefined, '10.0.0.3')).toBe('10.0.0.3')
    expect(clientIp('  ', undefined)).toBe('inconnue')
  })
})

describe('session', () => {
  it('dit qui est connecté et ce qu’il peut faire', async () => {
    expect((await call('anon', 'GET', '/api/moi')).body).toEqual({ user: null, role: null, portalUrl: 'https://portail.exemple.fr' })
    expect((await call('admin', 'GET', '/api/moi')).body).toMatchObject({ user: { email: 'admin@exemple.fr' }, role: 'admin' })
    expect((await call('reader', 'GET', '/api/moi')).body).toMatchObject({ role: 'lecteur' })
    expect((await call('outsider', 'GET', '/api/moi')).body).toMatchObject({ user: { email: 'exterieur@exemple.fr' }, role: null })
  })

  it('laisse les routes de connexion à Better Auth', async () => {
    expect((await app.request('/api/auth/sign-in/oauth2', { method: 'POST' })).status).toBe(418)
  })

  it('répond sur /api/health', async () => {
    expect(await call('anon', 'GET', '/api/health')).toEqual({ status: 200, body: { app: 'up', db: 'up' } })
  })
})

describe('administration', () => {
  it('refuse sans session (401) et sans rôle admin (403)', async () => {
    expect((await call('anon', 'POST', '/api/admin/commerciaux', { nom: 'Pirate' })).status).toBe(401)
    expect((await call('reader', 'POST', '/api/admin/commerciaux', { nom: 'Pirate' })).status).toBe(403)
    expect((await call('outsider', 'GET', '/api/admin/acces')).status).toBe(403)
  })

  it('enregistre un commercial, refuse un doublon avec le code SQL, puis le supprime', async () => {
    const created = await call('admin', 'POST', '/api/admin/commerciaux', {
      nom: 'Agathe Rolland',
      manager1: 'Hélène',
      structures: ['MD'],
      affectations: [{ structure: 'MD', zone_code: '22', couverture: 'propre' }],
      objectifs: [{ structure: 'MD', annee: 2026, ca: 1000.5, objectif: 2000 }],
    })
    expect(created.status).toBe(200)
    expect(created.body.id).toMatch(/^[0-9a-f-]{36}$/)
    const duplicate = await call('admin', 'POST', '/api/admin/commerciaux', { nom: ' agathe rolland ' })
    expect(duplicate).toMatchObject({ status: 409, body: { code: '23505' } })

    const map = (await call('admin', 'POST', '/api/carte', { code: null })).body
    expect(map.objectifs).toEqual([expect.objectContaining({ ca: 1000.5, objectif: 2000 })])

    expect((await call('admin', 'DELETE', `/api/admin/commerciaux/${created.body.id}`)).status).toBe(200)
    expect((await call('admin', 'DELETE', '/api/admin/commerciaux/pas-un-uuid')).status).toBe(400)
  })

  it('importe en une fois', async () => {
    const res = await call('admin', 'POST', '/api/admin/import', {
      items: [{ nom: 'Basile Fournier', structures: ['SP'], affectations: [{ structure: 'SP', zone_code: '2A', couverture: 'propre' }] }],
      deleteIds: [],
    })
    expect(res).toEqual({ status: 200, body: { saved: 1, deleted: 0 } })
    expect((await call('admin', 'POST', '/api/admin/import', { items: 'nope' })).status).toBe(400)
  })

  it('gère les managers : création, couleur, coordonnées, renommage, suppression', async () => {
    expect((await call('admin', 'POST', '/api/admin/managers', { nom: ' Victor ', couleur: '#123456' })).status).toBe(200)
    expect((await call('admin', 'POST', '/api/admin/managers', { nom: 'Victor', couleur: null })).body).toMatchObject({ code: '23505' })
    expect((await call('admin', 'PATCH', '/api/admin/managers/Victor', { telephone: '06 00 00 00 01', email: 'victor@exemple.fr' })).status).toBe(200)
    expect((await call('admin', 'PATCH', '/api/admin/managers/Victor', { email: 'pas-un-mail' })).body).toMatchObject({ code: '23514' })
    expect((await call('admin', 'POST', `/api/admin/managers/${encodeURIComponent('Victor')}/renommer`, { nom: 'Victor H.' })).status).toBe(200)
    const managers = (await call('admin', 'POST', '/api/carte', {})).body.managers as Record<string, unknown>[]
    expect(managers.find((m) => m.nom === 'Victor H.')).toMatchObject({ couleur: '#123456', telephone: '06 00 00 00 01' })
    expect((await call('admin', 'DELETE', `/api/admin/managers/${encodeURIComponent('Victor H.')}`)).status).toBe(200)
  })

  it('gère les structures et leur ordre', async () => {
    expect((await call('admin', 'POST', '/api/admin/structures', { code: 'nv', nom: 'Minuscules' })).body).toMatchObject({ code: '23514' })
    expect((await call('admin', 'POST', '/api/admin/structures', { code: 'NV', nom: 'Nouvelle', ordre: 5 })).status).toBe(200)
    expect((await call('admin', 'PATCH', '/api/admin/structures/NV', { code: 'NS', nom: 'Nouvelle structure' })).status).toBe(200)
    expect((await call('admin', 'PUT', '/api/admin/ordre-structures', { codes: ['NS', 'MD', 'SP', 'MC', 'BK'] })).status).toBe(200)
    const order = ((await call('admin', 'POST', '/api/carte', {})).body.structures as { code: string }[]).map((s) => s.code)
    expect(order).toEqual(['NS', 'MD', 'SP', 'MC', 'BK'])
    expect((await call('admin', 'DELETE', '/api/admin/structures/NS')).status).toBe(200)
    expect((await call('admin', 'PUT', '/api/admin/ordre-structures', { codes: ['MD', 'SP', 'MC', 'BK'] })).status).toBe(200)
  })

  it('règle l’affichage par défaut et refuse un mode inconnu', async () => {
    expect((await call('admin', 'PUT', '/api/admin/affichage', { mode: 'decoupage' })).status).toBe(200)
    expect((await call('admin', 'PUT', '/api/admin/affichage', { mode: 'paillettes' })).status).toBe(400)
  })
})

describe('code d’accès et lecture de la carte', () => {
  it('sans code défini : not_configured pour un visiteur', async () => {
    expect((await call('anon', 'POST', '/api/carte', { code: 'peu-importe' })).body).toEqual({ ok: false, error: 'not_configured' })
    expect((await call('admin', 'GET', '/api/admin/code')).body).toMatchObject({ configured: false })
  })

  it('un admin le définit (6 caractères au moins) ; le statut dit qui', async () => {
    expect((await call('admin', 'PUT', '/api/admin/code', { code: '12345' })).status).toBe(400)
    expect((await call('admin', 'PUT', '/api/admin/code', { code: 'Carte-2026!' })).status).toBe(200)
    expect((await call('admin', 'GET', '/api/admin/code')).body).toMatchObject({ configured: true, updated_by: 'admin@exemple.fr' })
  })

  it('ouvre la carte avec le code, ou sans code pour une lectrice venue par le portail', async () => {
    const visitor = (await call('anon', 'POST', '/api/carte', { code: 'Carte-2026!' })).body
    expect(visitor).toMatchObject({ ok: true, admin: false })
    expect((await call('reader', 'POST', '/api/carte', {})).body).toMatchObject({ ok: true, admin: false })
    expect((await call('outsider', 'POST', '/api/carte', {})).body).toEqual({ ok: false, error: 'invalid_code' })
  })

  it('limite les essais par adresse IP, sans se laisser tromper par cf-connecting-ip', async () => {
    const ip = { 'x-forwarded-for': '203.0.113.50, 10.0.0.2' }
    for (let i = 0; i < 10; i++) {
      // Un en-tête cf-connecting-ip différent à chaque essai ne change rien : il n'est plus lu (D-004)
      await call('anon', 'POST', '/api/carte', { code: `essai-${i}` }, { ...ip, 'cf-connecting-ip': `192.0.2.${i}` })
    }
    expect((await call('anon', 'POST', '/api/carte', { code: 'Carte-2026!' }, ip)).body).toEqual({ ok: false, error: 'too_many_attempts' })
    expect((await call('anon', 'POST', '/api/carte', { code: 'Carte-2026!' }, { 'x-forwarded-for': '203.0.113.51' })).body).toMatchObject({ ok: true })
  })
})

describe('rôles', () => {
  it('un admin en nomme un autre, qui l’est aussitôt', async () => {
    expect((await call('admin', 'PUT', `/api/admin/acces/${encodeURIComponent('Lectrice@Exemple.fr')}`, { role: 'admin' })).body).toEqual({ email: 'lectrice@exemple.fr' })
    expect((await call('reader', 'GET', '/api/moi')).body).toMatchObject({ role: 'admin' })
    const list = (await call('admin', 'GET', '/api/admin/acces')).body
    expect((list.roles as { email: string }[]).map((r) => r.email)).toEqual(['admin@exemple.fr', 'lectrice@exemple.fr'])
  })

  it('personne ne change ni ne retire son propre rôle', async () => {
    expect((await call('admin', 'PUT', '/api/admin/acces/admin@exemple.fr', { role: 'responsable' })).status).toBe(400)
    expect((await call('admin', 'DELETE', '/api/admin/acces/admin@exemple.fr')).status).toBe(400)
    expect((await call('admin', 'DELETE', '/api/admin/acces/inconnu@exemple.fr')).status).toBe(404)
  })

  it('un retrait vaut à la requête suivante', async () => {
    expect((await call('admin', 'DELETE', '/api/admin/acces/lectrice@exemple.fr')).status).toBe(200)
    expect((await call('reader', 'GET', '/api/moi')).body).toMatchObject({ role: 'lecteur' })
    expect((await call('reader', 'GET', '/api/admin/acces')).status).toBe(403)
  })

  it('refuse un rôle inconnu', async () => {
    expect((await call('admin', 'PUT', '/api/admin/acces/x@exemple.fr', { role: 'superadmin' })).body).toMatchObject({ code: '23514' })
  })
})

describe('routes inconnues', () => {
  it('répondent 404 en JSON sous /api', async () => {
    expect(await call('admin', 'GET', '/api/nulle-part')).toEqual({ status: 404, body: { error: 'Introuvable' } })
  })
})

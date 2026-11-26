// L'API de bout en bout : vraies migrations dans PGlite, vraies routes Hono ; seule la session est
// simulée (en-tête x-test-user), comme la donnerait Better Auth après la connexion par le portail.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { clientIp, createApp, failedSignInPath, returnPath, type SessionUser } from './app.ts'
import { VISITOR_SETTINGS, visitorParams, type Db } from './db.ts'

const MIGRATIONS = fileURLToPath(new URL('../db/migrations/', import.meta.url))

const USERS: Record<string, SessionUser> = {
  admin: { id: '00000000-0000-0000-0000-00000000000a', email: 'admin@exemple.fr', name: 'Admin', image: null, hasAccess: true },
  reader: { id: '00000000-0000-0000-0000-00000000000b', email: 'lectrice@exemple.fr', name: 'Lectrice', image: null, hasAccess: true },
  outsider: { id: '00000000-0000-0000-0000-00000000000c', email: 'exterieur@exemple.fr', name: 'Extérieur', image: null, hasAccess: false },
  manager: { id: '00000000-0000-0000-0000-00000000000d', email: 'manager@exemple.fr', name: 'Manager', image: null, hasAccess: true },
}

let pglite: PGlite
let app: ReturnType<typeof createApp>

/** Better Auth simulé : ce que reçoit le départ vers le portail, et s'il réussit. */
const signIns: { origin: string | null; body: Record<string, unknown> }[] = []
let portalDown = false

async function fakeAuthHandler(request: Request) {
  if (new URL(request.url).pathname !== '/api/auth/sign-in/social') return new Response('auth', { status: 418 })
  signIns.push({ origin: request.headers.get('origin'), body: await request.json() })
  if (portalDown) return Response.json({ message: 'Provider not found' }, { status: 404 })
  const headers = new Headers()
  headers.append('Set-Cookie', 'gd-map.state=etat; Path=/; HttpOnly; SameSite=Lax')
  headers.append('Set-Cookie', 'gd-map.pkce=verifier; Path=/; HttpOnly; SameSite=Lax')
  return Response.json({ url: 'https://portail.exemple.fr/api/auth/oauth2/authorize?state=etat', redirect: true }, { headers })
}

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
    authHandler: fakeAuthHandler,
    portalUrl: 'https://portail.exemple.fr',
    baseUrl: 'https://carte.exemple.fr',
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
    // Le droit d'usage du portail ne suffit plus : sans rôle dans la carte, pas de rôle (D-009)
    expect((await call('reader', 'GET', '/api/moi')).body).toMatchObject({ user: { email: 'lectrice@exemple.fr' }, role: null })
    expect((await call('outsider', 'GET', '/api/moi')).body).toMatchObject({ user: { email: 'exterieur@exemple.fr' }, role: null })
  })

  it('laisse les routes de connexion à Better Auth', async () => {
    expect((await app.request('/api/auth/callback/gdcom')).status).toBe(418)
  })

  it('répond sur /api/health', async () => {
    expect(await call('anon', 'GET', '/api/health')).toEqual({ status: 200, body: { app: 'up', db: 'up' } })
  })
})

describe('entrée par le portail (/api/connexion)', () => {
  const enter = (who: Who, query = '') =>
    app.request(`/api/connexion${query}`, { headers: who === 'anon' ? {} : { 'x-test-user': who }, redirect: 'manual' })

  it('part vers le portail avec le cookie d’état, et revient sur le chemin demandé', async () => {
    signIns.length = 0
    const res = await enter('anon', '?retour=%2Fadmin')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://portail.exemple.fr/api/auth/oauth2/authorize?state=etat')
    expect(res.headers.getSetCookie()).toEqual([
      'gd-map.state=etat; Path=/; HttpOnly; SameSite=Lax',
      'gd-map.pkce=verifier; Path=/; HttpOnly; SameSite=Lax',
    ])
    expect(signIns).toEqual([
      {
        origin: 'https://carte.exemple.fr',
        body: { provider: 'gdcom', callbackURL: '/admin', errorCallbackURL: '/admin?connexion=echec' },
      },
    ])
  })

  it('déjà venu avec l’accès : tout droit, sans repasser par le portail', async () => {
    signIns.length = 0
    const res = await enter('reader', '?retour=%2F')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/')
    expect(signIns).toEqual([])
  })

  it('connecté sans droit d’usage : repasse par le portail, qui a pu le lui donner depuis', async () => {
    signIns.length = 0
    expect((await enter('outsider')).headers.get('location')).toContain('portail.exemple.fr')
    expect(signIns).toHaveLength(1)
  })

  it('n’emmène jamais hors de la carte', async () => {
    for (const retour of ['//exemple.org', 'https://exemple.org', '/\\exemple.org', 'admin', '']) {
      expect(returnPath(retour), retour).toBe('/')
    }
    expect(returnPath('/admin/parametres')).toBe('/admin/parametres')
    expect(failedSignInPath('/?vue=paris')).toBe('/?vue=paris&connexion=echec')
  })

  it('portail injoignable : retour sur la carte, qui le dit', async () => {
    portalDown = true
    const res = await enter('anon', '?retour=%2Fadmin')
    portalDown = false
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/admin?connexion=echec')
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

  it('n\'importe plus d\'Excel (D-012)', async () => {
    expect((await call('admin', 'POST', '/api/admin/import', { items: [], deleteIds: [] })).status).toBe(404)
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

  it('ouvre la carte avec le code ; venu par le portail sans rôle, il faut aussi le code (D-009)', async () => {
    const visitor = (await call('anon', 'POST', '/api/carte', { code: 'Carte-2026!' })).body
    expect(visitor).toMatchObject({ ok: true, admin: false })
    expect((await call('reader', 'POST', '/api/carte', {})).body).toEqual({ ok: false, error: 'invalid_code' })
    expect((await call('reader', 'POST', '/api/carte', { code: 'Carte-2026!' })).body).toMatchObject({ ok: true, admin: false })
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
    expect((await call('admin', 'PUT', '/api/admin/acces/admin@exemple.fr', { role: 'admin' })).status).toBe(400)
    expect((await call('admin', 'DELETE', '/api/admin/acces/admin@exemple.fr')).status).toBe(400)
    expect((await call('admin', 'DELETE', '/api/admin/acces/inconnu@exemple.fr')).status).toBe(404)
  })

  it('un retrait vaut à la requête suivante', async () => {
    expect((await call('admin', 'DELETE', '/api/admin/acces/lectrice@exemple.fr')).status).toBe(200)
    expect((await call('reader', 'GET', '/api/moi')).body).toMatchObject({ role: null })
    expect((await call('reader', 'GET', '/api/admin/acces')).status).toBe(403)
  })

  it('refuse un rôle inconnu', async () => {
    expect((await call('admin', 'PUT', '/api/admin/acces/x@exemple.fr', { role: 'superadmin' })).body).toMatchObject({ code: '23514' })
  })
})

describe('manager (D-010)', () => {
  let sud: string
  let nord: string

  beforeAll(async () => {
    for (const [nom, manager2, zone_code] of [['Sud Un', 'Équipe Sud', '13'], ['Nord Un', 'Équipe Nord', '59']]) {
      const res = await call('admin', 'POST', '/api/admin/commerciaux', { nom, manager2, structures: ['MD'], affectations: [{ structure: 'MD', zone_code, couverture: 'propre' }] })
      if (nom === 'Sud Un') sud = res.body.id as string
      else nord = res.body.id as string
    }
  })

  it('un admin le relie à son compte GD One et coche ses structures', async () => {
    const url = `/api/admin/managers/${encodeURIComponent('Équipe Sud')}`
    expect((await call('admin', 'PATCH', url, { compte: 'pas-un-mail' })).body).toMatchObject({ code: '23514' })
    expect((await call('admin', 'PATCH', url, { structures: 'MD' })).status).toBe(400)
    expect((await call('admin', 'PATCH', url, { structures: ['XX'] })).body).toMatchObject({ code: '23503' })
    expect((await call('admin', 'PATCH', url, { compte: ' Manager@Exemple.fr ', structures: ['MD'] })).status).toBe(200)
    expect((await call('admin', 'PATCH', `/api/admin/managers/${encodeURIComponent('Équipe Nord')}`, { compte: 'manager@exemple.fr' })).body).toMatchObject({ code: '23505' })
    expect((await call('manager', 'GET', '/api/moi')).body).toMatchObject({ role: 'manager' })
    expect((await call('admin', 'PUT', '/api/admin/acces/x@exemple.fr', { role: 'responsable' })).body).toMatchObject({ code: '23514' })
  })

  it('ouvre la carte sans code, chiffres compris', async () => {
    expect((await call('manager', 'POST', '/api/carte', {})).body).toMatchObject({ ok: true, admin: false, chiffres: true, manager: { nom: 'Équipe Sud', structures: ['MD'] } })
    expect((await call('anon', 'POST', '/api/carte', { code: 'Carte-2026!' })).body).toMatchObject({ ok: true, chiffres: false, manager: null, objectifs: [] })
  })

  it('modifie les départements et les chiffres de son équipe, pas des autres', async () => {
    const objectifs = [{ structure: 'MD', annee: 2026, ca: 1500, objectif: 3000 }]
    const affectations = [{ structure: 'MD', zone_code: '13', couverture: 'propre' }, { structure: 'MD', zone_code: '83', couverture: 'gestion' }]
    expect((await call('anon', 'PUT', `/api/equipe/${sud}`, { objectifs })).status).toBe(401)
    expect((await call('reader', 'PUT', `/api/equipe/${sud}`, { objectifs })).status).toBe(403)
    expect((await call('admin', 'PUT', `/api/equipe/${sud}`, { objectifs })).status).toBe(403)

    expect((await call('manager', 'PUT', `/api/equipe/${sud}`, { objectifs, affectations })).status).toBe(200)
    const carte = (await call('manager', 'POST', '/api/carte', {})).body
    expect(carte.objectifs).toContainEqual(expect.objectContaining({ commercial_id: sud, ca: 1500, objectif: 3000 }))
    expect(carte.affectations).toContainEqual(expect.objectContaining({ commercial_id: sud, zone_code: '83', couverture: 'gestion' }))

    const taken = await call('manager', 'PUT', `/api/equipe/${sud}`, { affectations: [...affectations, { structure: 'MD', zone_code: '59', couverture: 'partiel' }] })
    expect(taken).toMatchObject({ status: 400, body: { error: expect.stringContaining('déjà occupé par Nord Un') } })
    expect((await call('manager', 'PUT', `/api/equipe/${nord}`, { objectifs })).status).toBe(403)
    expect((await call('manager', 'PUT', `/api/equipe/${sud}`, { objectifs: 'nope' })).status).toBe(400)
    expect((await call('manager', 'PUT', `/api/equipe/${sud}`, { affectations: {} })).status).toBe(400)
    expect((await call('manager', 'PUT', `/api/equipe/${sud}`, { nom: 'Autre nom' })).status).toBe(400)
    expect((await call('manager', 'PUT', '/api/equipe/pas-un-uuid', { objectifs })).status).toBe(400)
    expect((await call('manager', 'POST', '/api/admin/commerciaux', { nom: 'Intrus' })).status).toBe(403)
    expect((await call('manager', 'PUT', '/api/admin/managers-actifs', { manager1: true, manager2: false })).status).toBe(403)
  })

  it('lit le journal de son équipe ; les autres ne le lisent pas', async () => {
    expect((await call('anon', 'GET', '/api/journal')).status).toBe(401)
    expect((await call('reader', 'GET', '/api/journal')).status).toBe(403)
    const mine = (await call('manager', 'GET', '/api/journal')).body.lignes as { nom: string; auteur: string }[]
    expect(new Set(mine.map((l) => l.nom))).toEqual(new Set(['Sud Un']))
    expect(mine[0].auteur).toBe('manager@exemple.fr')
    expect((await call('admin', 'GET', `/api/journal?commercial=${nord}`)).body).toMatchObject({ page: 1, taille: 20, total: 1 })
    expect((await call('manager', 'GET', '/api/journal?recherche=Sud%20Un')).body.total).toBeGreaterThan(0)
    expect((await call('manager', 'GET', '/api/journal?recherche=Nord%20Un')).body).toMatchObject({ total: 0, lignes: [] })
    for (const page of ['abc', '0', '-1']) expect((await call('admin', 'GET', `/api/journal?page=${page}`)).status).toBe(400)
    expect((await call('admin', 'GET', '/api/journal?commercial=abc')).status).toBe(400)
  })

  it('Manager 1 et Manager 2 se règlent pour toute la carte', async () => {
    expect((await call('admin', 'PUT', '/api/admin/managers-actifs', { manager1: false, manager2: false })).status).toBe(400)
    expect((await call('admin', 'PUT', '/api/admin/managers-actifs', { manager1: 'non', manager2: true })).status).toBe(400)
    expect((await call('admin', 'PUT', '/api/admin/managers-actifs', { manager1: false, manager2: true })).status).toBe(200)
    expect((await call('anon', 'POST', '/api/carte', { code: 'Carte-2026!' })).body).toMatchObject({ settings: { manager1_actif: false, manager2_actif: true } })
    expect((await call('admin', 'PUT', '/api/admin/managers-actifs', { manager1: true, manager2: true })).status).toBe(200)
  })

  it('délié de son compte, il n\'a plus que le code', async () => {
    expect((await call('admin', 'PATCH', `/api/admin/managers/${encodeURIComponent('Équipe Sud')}`, { compte: null })).status).toBe(200)
    expect((await call('manager', 'GET', '/api/moi')).body).toMatchObject({ role: null })
    expect((await call('manager', 'PUT', `/api/equipe/${sud}`, { objectifs: [] })).status).toBe(403)
  })
})

describe('départements à recruter (D-011)', () => {
  it('un admin pose priorités et secteurs, et convertit les anciennes fiches', async () => {
    expect((await call('admin', 'PUT', '/api/admin/recrutement/MD', { zones: [{ zone_code: '18', priorite: 1, secteur: 'Centre' }] })).status).toBe(200)
    expect((await call('admin', 'PUT', '/api/admin/recrutement/MD', { zones: 'nope' })).status).toBe(400)
    expect((await call('admin', 'PUT', '/api/admin/recrutement/MD', { zones: [{ zone_code: '59', priorite: 5 }] })).status).toBe(400)
    const fiche = await call('admin', 'POST', '/api/admin/commerciaux', { nom: 'À recruter – Est', structures: ['MD'], affectations: [{ structure: 'MD', zone_code: '67', couverture: 'propre' }] })
    expect((await call('admin', 'POST', '/api/admin/recrutement/convertir', { ids: [fiche.body.id] })).body).toEqual({ fiches: 1, zones: 1 })
    expect((await call('admin', 'POST', '/api/admin/recrutement/convertir', { ids: 'nope' })).status).toBe(400)
    const visitor = (await call('anon', 'POST', '/api/carte', { code: 'Carte-2026!' })).body
    expect(visitor.a_recruter).toEqual([
      { structure: 'MD', zone_code: '18', priorite: 1, secteur: 'Centre' },
      { structure: 'MD', zone_code: '67', priorite: null, secteur: 'Est' },
    ])
    expect((await call('reader', 'PUT', '/api/admin/recrutement/MD', { zones: [] })).status).toBe(403)
  })
})

describe('routes inconnues', () => {
  it('répondent 404 en JSON sous /api', async () => {
    expect(await call('admin', 'GET', '/api/nulle-part')).toEqual({ status: 404, body: { error: 'Introuvable' } })
  })
})

// Tests des règles d'accès : les migrations sont jouées dans PGlite (Postgres en WASM),
// avec un environnement minimal qui imite Supabase (rôles anon/authenticated, auth.users, auth.uid()).
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url))

const ADMIN = '00000000-0000-0000-0000-00000000000a'
const USER = '00000000-0000-0000-0000-00000000000b'

// Ce que Supabase fournit avant nos migrations.
// autoGrants = option « exposer automatiquement les nouvelles tables » (activée par défaut chez Supabase).
const supabaseStub = (autoGrants: boolean) => `
  create schema auth;
  create schema extensions;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public, auth, extensions to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  ${autoGrants ? `
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;` : ''}
  insert into auth.users values ('${ADMIN}', 'admin@exemple.fr'), ('${USER}', 'autre@exemple.fr');
`

describe.each([
  ['droits automatiques de Supabase', true],
  ['sans exposition automatique des tables', false],
])('%s', (_label, autoGrants) => {
  let db: PGlite

  type Who = 'anon' | 'admin' | 'user' | 'postgres'

  /** Exécute une requête avec le rôle et l'utilisateur voulus, puis revient au superutilisateur. */
  async function as<T = Record<string, unknown>>(who: Who, sql: string, params: unknown[] = []): Promise<T[]> {
    const role = who === 'anon' ? 'anon' : who === 'postgres' ? 'postgres' : 'authenticated'
    const sub = who === 'admin' ? ADMIN : who === 'user' ? USER : ''
    await db.exec(`set request.jwt.claim.sub = '${sub}'; set role ${role};`)
    try {
      return (await db.query<T>(sql, params)).rows
    } finally {
      await db.exec(`reset role; reset request.jwt.claim.sub;`)
    }
  }

  const rpc = async (who: Who, fn: string, args: string, params: unknown[] = []) =>
    (await as<{ r: unknown }>(who, `select public.${fn}(${args}) as r`, params))[0].r as Record<string, unknown>

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } })
    await db.exec(supabaseStub(autoGrants))
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
      await db.exec(readFileSync(MIGRATIONS + file, 'utf8'))
    }
    await db.exec(`insert into public.admins (user_id, email) values ('${ADMIN}', 'admin@exemple.fr')`)
  }, 60_000)

  describe('migrations', () => {
    it('remplissent les zones', async () => {
      const [{ n }] = await as<{ n: number }>('postgres', 'select count(*)::int as n from public.zones')
      expect(n).toBe(122)
    })

    it('activent RLS sur toutes les tables', async () => {
      const rows = await as<{ relname: string }>(
        'postgres',
        `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`,
      )
      expect(rows).toEqual([])
    })
  })

  describe('anonyme (sans connexion)', () => {
    it('ne peut lire aucune table', async () => {
      for (const table of ['commerciaux', 'affectations', 'objectifs', 'zones', 'settings', 'admins', 'access_attempts', 'managers', 'structures']) {
        await expect(as('anon', `select * from public.${table}`), table).rejects.toThrow(/permission denied/)
      }
    })

    it('ne peut pas écrire ni appeler les fonctions d\'admin', async () => {
      await expect(as('anon', `insert into public.commerciaux (nom) values ('Pirate')`)).rejects.toThrow(/permission denied/)
      await expect(rpc('anon', 'set_access_code', `'nouveau-code'`)).rejects.toThrow(/permission denied/)
      await expect(rpc('anon', 'save_commercial', `'{"nom":"Pirate"}'::jsonb`)).rejects.toThrow(/permission denied/)
      await expect(rpc('anon', 'is_admin', '')).rejects.toThrow(/permission denied/)
    })

    it('reçoit not_configured tant qu\'aucun code n\'est défini', async () => {
      expect(await rpc('anon', 'get_map_data', `'peu-importe'`)).toEqual({ ok: false, error: 'not_configured' })
    })
  })

  describe('utilisateur connecté mais pas admin', () => {
    it('ne voit rien et ne peut rien modifier', async () => {
      await as('postgres', `insert into public.commerciaux (nom) values ('Visible seulement des admins')`)
      expect(await as('user', 'select * from public.commerciaux')).toEqual([])
      expect(await as('user', 'select * from public.admins')).toEqual([])
      await expect(as('user', `insert into public.commerciaux (nom) values ('Intrus')`)).rejects.toThrow(/row-level security/)
      await expect(rpc('user', 'save_commercial', `'{"nom":"Intrus"}'::jsonb`)).rejects.toThrow(/réservé aux admins/)
      await expect(rpc('user', 'set_access_code', `'nouveau-code'`)).rejects.toThrow(/réservé aux admins/)
      await expect(as('user', `insert into public.admins (user_id, email) values ('${USER}', 'x')`)).rejects.toThrow(/row-level security/)
      expect(await rpc('user', 'is_admin', '')).toBe(false)
      await as('postgres', `delete from public.commerciaux`)
    })
  })

  describe('admin', () => {
    let id: string

    it('est reconnu', async () => {
      expect(await rpc('admin', 'is_admin', '')).toBe(true)
    })

    it('crée un commercial avec ses zones et objectifs en un appel', async () => {
      id = (await rpc('admin', 'save_commercial', '$1::jsonb', [
        JSON.stringify({
          nom: 'Agathe Rolland',
          statut: 'VRP',
          manager1: 'Hélène',
          couleur: '#e6194b',
          notes: 'Note interne',
          actions: 'Départ 2027',
          structures: ['MD'],
          affectations: [
            { structure: 'MD', zone_code: '22', couverture: 'propre' },
            { structure: 'MD', zone_code: '35', couverture: 'partiel' },
            { structure: 'MD', zone_code: '75-7', couverture: 'gestion' },
          ],
          objectifs: [{ structure: 'MD', annee: 2026, ca: 1000, objectif: 2000 }],
        }),
      ])) as unknown as string
      expect(id).toMatch(/^[0-9a-f-]{36}$/)
      expect(await as('admin', 'select zone_code, couverture from public.affectations order by zone_code')).toEqual([
        { zone_code: '22', couverture: 'propre' },
        { zone_code: '35', couverture: 'partiel' },
        { zone_code: '75-7', couverture: 'gestion' },
      ])
    })

    it('met à jour seulement les champs envoyés et remplace les zones', async () => {
      await rpc('admin', 'save_commercial', '$1::jsonb', [
        JSON.stringify({ id, statut: 'ATC', affectations: [{ structure: 'MD', zone_code: '29', couverture: 'propre' }] }),
      ])
      const [c] = await as<{ statut: string; manager1: string; notes: string }>('admin', 'select statut, manager1, notes from public.commerciaux')
      expect(c).toEqual({ statut: 'ATC', manager1: 'Hélène', notes: 'Note interne' })
      expect(await as('admin', 'select zone_code from public.affectations')).toEqual([{ zone_code: '29' }])
    })

    it('refuse une zone inconnue et un nom en double', async () => {
      await expect(
        rpc('admin', 'save_commercial', '$1::jsonb', [
          JSON.stringify({ nom: 'Bob', affectations: [{ structure: 'MD', zone_code: '96', couverture: 'propre' }] }),
        ]),
      ).rejects.toThrow(/foreign key/)
      await expect(rpc('admin', 'save_commercial', '$1::jsonb', [JSON.stringify({ nom: ' agathe rolland ' })])).rejects.toThrow(/duplicate key/)
    })

    it('importe en une transaction (ajout, mise à jour, suppression)', async () => {
      const res = await rpc('admin', 'apply_import', '$1::jsonb, $2::uuid[]', [
        JSON.stringify([
          { nom: 'Basile Fournier', couleur: '#3cb44b', structures: ['SP'], affectations: [{ structure: 'SP', zone_code: '2A', couverture: 'propre' }] },
          { nom: 'Capucine Delorme', couleur: '#4363d8', structures: ['MD'], affectations: [{ structure: 'MD', zone_code: '98', couverture: 'propre' }] },
        ]),
        [id],
      ])
      expect(res).toEqual({ saved: 2, deleted: 1 })
      expect((await as<{ nom: string }>('admin', 'select nom from public.commerciaux order by nom')).map((r) => r.nom)).toEqual([
        'Basile Fournier',
        'Capucine Delorme',
      ])
    })

    it('annule tout l\'import si une ligne est invalide', async () => {
      await expect(
        rpc('admin', 'apply_import', '$1::jsonb, $2::uuid[]', [
          JSON.stringify([{ nom: 'Nouveau' }, { nom: 'Erreur', affectations: [{ structure: 'XX', zone_code: '22' }] }]),
          [],
        ]),
      ).rejects.toThrow()
      const rows = await as<{ nom: string }>('admin', `select nom from public.commerciaux where nom = 'Nouveau'`)
      expect(rows).toEqual([])
    })

    it('ne lit pas directement le hash du code', async () => {
      await expect(as('admin', 'select * from public.settings')).rejects.toThrow(/permission denied/)
    })

    it('ne peut pas se retirer lui-même de la liste des admins', async () => {
      await as('admin', `delete from public.admins where user_id = '${ADMIN}'`)
      expect(await rpc('admin', 'is_admin', '')).toBe(true)
    })
  })

  describe('code d\'accès', () => {
    it('refuse un code trop court', async () => {
      await expect(rpc('admin', 'set_access_code', `'12345'`)).rejects.toThrow(/au moins 6/)
    })

    it('est stocké en bcrypt, jamais en clair', async () => {
      await rpc('admin', 'set_access_code', `'Carte-2026!'`)
      const [{ access_code_hash }] = await as<{ access_code_hash: string }>('postgres', 'select access_code_hash from public.settings')
      expect(access_code_hash).toMatch(/^\$2[aby]\$10\$/)
      expect(access_code_hash).not.toContain('Carte-2026!')
      const status = await rpc('admin', 'get_access_status', '')
      expect(status).toMatchObject({ configured: true, updated_by: 'admin@exemple.fr' })
    })

    it('donne accès aux données avec le bon code, sans les champs réservés aux admins', async () => {
      await as('postgres', `update public.commerciaux set notes = 'secret', actions = 'confidentiel' where nom = 'Basile Fournier'`)
      const res = await rpc('anon', 'get_map_data', `'Carte-2026!'`)
      expect(res.ok).toBe(true)
      expect(res.admin).toBe(false)
      const commerciaux = res.commerciaux as Record<string, unknown>[]
      expect(commerciaux.map((c) => c.nom)).toEqual(['Basile Fournier', 'Capucine Delorme'])
      expect(commerciaux[0]).not.toHaveProperty('notes')
      expect(commerciaux[0]).not.toHaveProperty('actions')
      expect((res.affectations as unknown[]).length).toBe(2)
    })

    it('ne donne jamais le CA ni les objectifs aux visiteurs, seulement aux admins', async () => {
      const [{ id }] = await as<{ id: string }>('postgres', `select id from public.commerciaux where nom = 'Basile Fournier'`)
      await as('postgres', `insert into public.objectifs (commercial_id, structure, annee, ca, objectif) values ('${id}', 'SP', 2026, 1000, 2000)`)
      const visitor = await rpc('anon', 'get_map_data', `'Carte-2026!'`)
      expect(visitor.objectifs).toEqual([])
      const admin = await rpc('admin', 'get_map_data', 'null')
      expect(admin.objectifs).toEqual([expect.objectContaining({ structure: 'SP', annee: 2026, ca: 1000, objectif: 2000 })])
    })

    it('masque les commerciaux inactifs aux visiteurs, pas aux admins', async () => {
      await as('postgres', `update public.commerciaux set actif = false where nom = 'Capucine Delorme'`)
      const visitor = await rpc('anon', 'get_map_data', `'Carte-2026!'`)
      expect((visitor.commerciaux as unknown[]).length).toBe(1)
      expect((visitor.affectations as unknown[]).length).toBe(1)
      const admin = await rpc('admin', 'get_map_data', 'null')
      expect((admin.commerciaux as unknown[]).length).toBe(2)
      expect((admin.commerciaux as Record<string, unknown>[])[0]).toHaveProperty('notes', 'secret')
      await as('postgres', `update public.commerciaux set actif = true`)
    })

    it('refuse un mauvais code', async () => {
      expect(await rpc('anon', 'get_map_data', `'mauvais'`)).toEqual({ ok: false, error: 'invalid_code' })
      expect(await rpc('anon', 'get_map_data', 'null')).toEqual({ ok: false, error: 'invalid_code' })
      expect(await rpc('user', 'get_map_data', 'null')).toEqual({ ok: false, error: 'invalid_code' })
    })

    it('bloque après 10 essais ratés, même avec le bon code', async () => {
      for (let i = 0; i < 10; i++) await rpc('anon', 'get_map_data', `'essai-${i}'`)
      expect(await rpc('anon', 'get_map_data', `'Carte-2026!'`)).toEqual({ ok: false, error: 'too_many_attempts' })
      // Un admin n'est pas concerné
      expect((await rpc('admin', 'get_map_data', 'null')).ok).toBe(true)
    })

    it('changer le code remet le compteur à zéro et invalide l\'ancien', async () => {
      await rpc('admin', 'set_access_code', `'Nouveau-code-2027'`)
      expect(await rpc('anon', 'get_map_data', `'Carte-2026!'`)).toEqual({ ok: false, error: 'invalid_code' })
      expect((await rpc('anon', 'get_map_data', `'Nouveau-code-2027'`)).ok).toBe(true)
    })
  })

  describe('managers', () => {
    it('sont créés à la volée par save_commercial (saisie libre, import)', async () => {
      await rpc('admin', 'save_commercial', '$1::jsonb', [JSON.stringify({ nom: 'Manon Test', manager1: ' Victor ', manager2: 'Direction Nord' })])
      const rows = await as<{ nom: string }>('admin', `select nom from public.managers where nom in ('Victor', 'Direction Nord') order by nom`)
      expect(rows.map((r) => r.nom)).toEqual(['Direction Nord', 'Victor'])
    })

    it('sont renvoyés avec la carte', async () => {
      const res = await rpc('admin', 'get_map_data', 'null')
      expect((res.managers as { nom: string }[]).map((m) => m.nom)).toContain('Victor')
    })

    it('renommer met à jour les commerciaux', async () => {
      await rpc('admin', 'rename_manager', `'Victor', 'Victor H.'`)
      const [c] = await as<{ manager1: string }>('admin', `select manager1 from public.commerciaux where nom = 'Manon Test'`)
      expect(c.manager1).toBe('Victor H.')
    })

    it('renommer vers un nom existant fusionne les deux', async () => {
      await rpc('admin', 'rename_manager', `'Direction Nord', 'Victor H.'`)
      const [c] = await as<{ manager1: string; manager2: string }>('admin', `select manager1, manager2 from public.commerciaux where nom = 'Manon Test'`)
      expect(c).toEqual({ manager1: 'Victor H.', manager2: 'Victor H.' })
      expect(await as('admin', `select nom from public.managers where nom = 'Direction Nord'`)).toEqual([])
    })

    it('supprimer un manager laisse ses commerciaux sans manager', async () => {
      await as('admin', `delete from public.managers where nom = 'Victor H.'`)
      const [c] = await as<{ manager1: string | null; manager2: string | null }>('admin', `select manager1, manager2 from public.commerciaux where nom = 'Manon Test'`)
      expect(c).toEqual({ manager1: null, manager2: null })
    })

    it('un non-admin ne peut ni lire ni modifier les managers', async () => {
      expect(await as('user', 'select * from public.managers')).toEqual([])
      await expect(as('user', `insert into public.managers (nom) values ('Pirate')`)).rejects.toThrow(/row-level security/)
      await expect(rpc('user', 'rename_manager', `'Hélène', 'Pirate'`)).rejects.toThrow(/réservé aux admins/)
    })
  })

  describe('structures', () => {
    const codes = async () => (await as<{ code: string }>('admin', 'select code from public.structures order by ordre, code')).map((r) => r.code)
    const structuresOf = async (nom: string) =>
      (await as<{ structures: string[] }>('admin', `select structures from public.commerciaux where nom = $1`, [nom]))[0].structures

    it('partent des quatre structures d\'origine, renvoyées avec la carte (visiteurs compris)', async () => {
      expect(await codes()).toEqual(['MD', 'SP', 'MC', 'BK'])
      const visitor = await rpc('anon', 'get_map_data', `'Nouveau-code-2027'`)
      expect(visitor.structures).toEqual([
        { code: 'MD', nom: 'Maison Davoise', ordre: 1 },
        { code: 'SP', nom: 'Splayce', ordre: 2 },
        { code: 'MC', nom: 'MaucoCartex', ordre: 3 },
        { code: 'BK', nom: 'BK Event', ordre: 4 },
      ])
    })

    it('un admin en ajoute une, utilisable aussitôt pour les zones et les objectifs', async () => {
      await as('admin', `insert into public.structures (code, nom, ordre) values ('NV', 'Nouvelle structure', 5)`)
      await rpc('admin', 'save_commercial', '$1::jsonb', [
        JSON.stringify({
          nom: 'Structure Test',
          structures: ['MD', 'NV'],
          affectations: [
            { structure: 'NV', zone_code: '13', couverture: 'propre' },
            { structure: 'MD', zone_code: '84', couverture: 'propre' },
          ],
          objectifs: [{ structure: 'NV', annee: 2026, ca: 10, objectif: 20 }],
        }),
      ])
      expect(await structuresOf('Structure Test')).toEqual(['MD', 'NV'])
    })

    it('refuse un code mal formé, réservé ou une structure inconnue', async () => {
      await expect(as('admin', `insert into public.structures (code, nom) values ('nv2', 'Minuscules')`)).rejects.toThrow(/check constraint/)
      await expect(as('admin', `insert into public.structures (code, nom) values ('ALL', 'Onglet Globale')`)).rejects.toThrow(/check constraint/)
      await expect(as('admin', `insert into public.structures (code, nom) values ('MD', 'Doublon')`)).rejects.toThrow(/duplicate key/)
      const [{ id }] = await as<{ id: string }>('admin', `select id from public.commerciaux where nom = 'Structure Test'`)
      await expect(rpc('admin', 'save_commercial', '$1::jsonb', [JSON.stringify({ id, structures: ['ZZ'] })])).rejects.toThrow(
        /Structure inconnue : ZZ/,
      )
      await expect(
        rpc('admin', 'save_commercial', '$1::jsonb', [
          JSON.stringify({ id, affectations: [{ structure: 'ZZ', zone_code: '13', couverture: 'propre' }] }),
        ]),
      ).rejects.toThrow(/foreign key/)
      expect(await structuresOf('Structure Test')).toEqual(['MD', 'NV'])
    })

    it('changer le code met à jour zones, objectifs et commerciaux', async () => {
      await as('admin', `update public.structures set code = 'NS' where code = 'NV'`)
      expect(await structuresOf('Structure Test')).toEqual(['MD', 'NS'])
      const [{ n }] = await as<{ n: number }>('admin', `select count(*)::int as n from public.affectations where structure = 'NS'`)
      expect(n).toBe(1)
      const [{ o }] = await as<{ o: number }>('admin', `select count(*)::int as o from public.objectifs where structure = 'NS'`)
      expect(o).toBe(1)
    })

    it('se réordonnent en une fois', async () => {
      await rpc('admin', 'reorder_structures', `array['NS', 'SP', 'MD', 'MC', 'BK']`)
      expect(await codes()).toEqual(['NS', 'SP', 'MD', 'MC', 'BK'])
      await rpc('admin', 'reorder_structures', `array['MD', 'SP', 'MC', 'BK', 'NS']`)
    })

    it('supprimer une structure retire ses zones, ses objectifs et la coche des commerciaux', async () => {
      await as('admin', `delete from public.structures where code = 'NS'`)
      expect(await structuresOf('Structure Test')).toEqual(['MD'])
      const [{ n }] = await as<{ n: number }>('admin', `select count(*)::int as n from public.affectations where structure = 'NS'`)
      expect(n).toBe(0)
      const [{ o }] = await as<{ o: number }>('admin', `select count(*)::int as o from public.objectifs where structure = 'NS'`)
      expect(o).toBe(0)
      // Les zones des autres structures restent
      const [{ md }] = await as<{ md: number }>(
        'admin',
        `select count(*)::int as md from public.affectations a join public.commerciaux c on c.id = a.commercial_id where c.nom = 'Structure Test'`,
      )
      expect(md).toBe(1)
      await as('admin', `delete from public.commerciaux where nom = 'Structure Test'`)
    })

    it('un non-admin ne peut ni lire ni modifier les structures', async () => {
      expect(await as('user', 'select * from public.structures')).toEqual([])
      await expect(as('user', `insert into public.structures (code, nom) values ('PI', 'Pirate')`)).rejects.toThrow(/row-level security/)
      await expect(as('anon', `insert into public.structures (code, nom) values ('PI', 'Pirate')`)).rejects.toThrow(/permission denied/)
      await expect(rpc('user', 'reorder_structures', `array['BK']`)).rejects.toThrow(/réservé aux admins/)
      await expect(rpc('anon', 'reorder_structures', `array['BK']`)).rejects.toThrow(/permission denied/)
      expect(await codes()).toEqual(['MD', 'SP', 'MC', 'BK'])
    })
  })

  describe('statuts', () => {
    it('la migration ramène chaque statut à une seule écriture (casse, accents, espaces)', async () => {
      const noms = ['St 1', 'St 2', 'St 3', 'St 4', 'St 5', 'St 6', 'St 7']
      const statuts = ['A recruter', ' à  recruter ', 'Agent Commercial', 'ATC Splayce', 'ATC Splayce', 'atc splayce', 'VRP']
      for (const [i, nom] of noms.entries()) {
        await as('postgres', `insert into public.commerciaux (nom, statut) values ($1, $2)`, [nom, statuts[i]])
      }
      const file = readdirSync(MIGRATIONS).find((f) => f.endsWith('_statuts.sql'))!
      await db.exec(readFileSync(MIGRATIONS + file, 'utf8'))
      const rows = await as<{ statut: string }>('postgres', `select statut from public.commerciaux where nom like 'St %' order by nom`)
      expect(rows.map((r) => r.statut)).toEqual(['À recruter', 'À recruter', 'Agent commercial', 'ATC Splayce', 'ATC Splayce', 'ATC Splayce', 'VRP'])
      // Rejouée, elle ne change plus rien
      await db.exec(readFileSync(MIGRATIONS + file, 'utf8'))
      const again = await as<{ statut: string }>('postgres', `select statut from public.commerciaux where nom like 'St %' order by nom`)
      expect(again).toEqual(rows)
      await as('postgres', `delete from public.commerciaux where nom like 'St %'`)
    })
  })

  describe('téléphone et e-mail', () => {
    it('s\'enregistrent avec le commercial (e-mail en minuscules) et partent avec la carte, code compris', async () => {
      await rpc('admin', 'save_commercial', '$1::jsonb', [
        JSON.stringify({ nom: 'Contact Test', manager1: 'Hélène', telephone: '06 39 98 00 01', email: ' Contact.Test@Example.com ' }),
      ])
      await as('admin', `update public.managers set telephone = '06 39 98 00 02', email = 'helene@example.com' where nom = 'Hélène'`)
      const visitor = await rpc('anon', 'get_map_data', `'Nouveau-code-2027'`)
      const c = (visitor.commerciaux as Record<string, unknown>[]).find((x) => x.nom === 'Contact Test')
      expect(c).toMatchObject({ telephone: '06 39 98 00 01', email: 'contact.test@example.com' })
      const m = (visitor.managers as Record<string, unknown>[]).find((x) => x.nom === 'Hélène')
      expect(m).toMatchObject({ telephone: '06 39 98 00 02', email: 'helene@example.com' })
    })

    it('une mise à jour sans ces champs ne les efface pas ; une valeur vide les efface', async () => {
      const [{ id }] = await as<{ id: string }>('admin', `select id from public.commerciaux where nom = 'Contact Test'`)
      await rpc('admin', 'save_commercial', '$1::jsonb', [JSON.stringify({ id, statut: 'VRP' })])
      const [a] = await as<{ telephone: string; email: string }>('admin', `select telephone, email from public.commerciaux where id = $1`, [id])
      expect(a).toEqual({ telephone: '06 39 98 00 01', email: 'contact.test@example.com' })
      await rpc('admin', 'save_commercial', '$1::jsonb', [JSON.stringify({ id, telephone: '', email: '' })])
      const [b] = await as<{ telephone: string | null; email: string | null }>('admin', `select telephone, email from public.commerciaux where id = $1`, [id])
      expect(b).toEqual({ telephone: null, email: null })
    })

    it('refuse un e-mail ou un téléphone illisible', async () => {
      const [{ id }] = await as<{ id: string }>('admin', `select id from public.commerciaux where nom = 'Contact Test'`)
      await expect(rpc('admin', 'save_commercial', '$1::jsonb', [JSON.stringify({ id, email: 'pas-un-mail' })])).rejects.toThrow(/check constraint/)
      await expect(rpc('admin', 'save_commercial', '$1::jsonb', [JSON.stringify({ id, telephone: 'voir agence' })])).rejects.toThrow(/check constraint/)
    })

    it('fusionner deux managers garde les coordonnées de l\'un ou de l\'autre', async () => {
      await as('admin', `insert into public.managers (nom, telephone, email) values ('Doublon Hélène', '06 39 98 00 03', 'doublon@example.com')`)
      await as('admin', `update public.managers set telephone = null where nom = 'Hélène'`)
      await rpc('admin', 'rename_manager', `'Doublon Hélène', 'Hélène'`)
      const [m] = await as<{ telephone: string; email: string }>('admin', `select telephone, email from public.managers where nom = 'Hélène'`)
      expect(m).toEqual({ telephone: '06 39 98 00 03', email: 'helene@example.com' })
      await as('admin', `delete from public.commerciaux where nom = 'Contact Test'`)
    })
  })

  describe('mode des zones partagées par défaut', () => {
    it('vaut « rayures » et part avec la carte', async () => {
      const res = await rpc('admin', 'get_map_data', 'null')
      expect(res.settings).toEqual({ default_shared_mode: 'rayures' })
    })

    it('un admin le change, pour tout le monde', async () => {
      await rpc('admin', 'set_default_shared_mode', `'decoupage'`)
      const visitor = await rpc('anon', 'get_map_data', `'Nouveau-code-2027'`)
      expect(visitor.settings).toEqual({ default_shared_mode: 'decoupage' })
    })

    it('refuse un mode inconnu et les non-admins', async () => {
      await expect(rpc('admin', 'set_default_shared_mode', `'paillettes'`)).rejects.toThrow(/Mode inconnu/)
      await expect(rpc('user', 'set_default_shared_mode', `'rayures'`)).rejects.toThrow(/réservé aux admins/)
      await expect(rpc('anon', 'set_default_shared_mode', `'rayures'`)).rejects.toThrow(/permission denied/)
    })
  })

  describe('compatibilité Supabase', () => {
    // En production, l'extension safeupdate refuse tout DELETE ou UPDATE sans WHERE venant de l'API
    it('aucune fonction ne fait de DELETE ou d\'UPDATE sans WHERE', async () => {
      const fns = await as<{ proname: string; prosrc: string }>(
        'postgres',
        `select proname, prosrc from pg_proc where pronamespace = 'public'::regnamespace and prolang = (select oid from pg_language where lanname = 'plpgsql')`,
      )
      const offenders = fns.flatMap((f) =>
        f.prosrc
          .replace(/--[^\n]*/g, '')
          .split(';')
          .map((st) => st.trim().replace(/\s+/g, ' '))
          .filter((st) => /^(delete from|update) /i.test(st) && !/\bwhere\b/i.test(st))
          .map((st) => `${f.proname} : ${st.slice(0, 60)}`),
      )
      expect(offenders).toEqual([])
    })
  })

  describe('ping', () => {
    it('répond à un visiteur anonyme (workflow keepalive)', async () => {
      expect(await rpc('anon', 'ping', '')).toBe('ok')
    })
  })
})

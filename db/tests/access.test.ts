// Tests des règles d'accès : toutes les migrations (socle compris) sont jouées dans PGlite (Postgres en
// WASM), puis chaque requête passe avec le rôle, l'utilisateur et l'IP que pose le serveur (server/db.ts).
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url))

// Cinq personnes venues par le portail : un admin, deux managers (D-010), une lectrice (accès sur le portail
// sans rôle : elle n'a que le code, comme tout le monde) et un compte sans accès à la carte.
const ADMIN = '00000000-0000-0000-0000-00000000000a'
const READER = '00000000-0000-0000-0000-00000000000b'
const OUTSIDER = '00000000-0000-0000-0000-00000000000c'
const SUD = '00000000-0000-0000-0000-00000000000d'
const NORD = '00000000-0000-0000-0000-00000000000e'

describe('règles d\'accès', () => {
  let db: PGlite

  type Who = 'anon' | 'admin' | 'reader' | 'outsider' | 'sud' | 'nord' | 'postgres'
  const SUB: Record<Who, string> = { anon: '', admin: ADMIN, reader: READER, outsider: OUTSIDER, sud: SUD, nord: NORD, postgres: '' }

  /** Exécute une requête comme le serveur : rôle, utilisateur et IP posés pour la transaction. */
  async function as<T = Record<string, unknown>>(who: Who, sql: string, params: unknown[] = [], ip = '198.51.100.7'): Promise<T[]> {
    if (who === 'postgres') return (await db.query<T>(sql, params)).rows
    const role = who === 'anon' ? 'anon' : 'authenticated'
    return db.transaction(async (tx) => {
      await tx.query(
        `select set_config('role', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('app.client_ip', $3, true)`,
        [role, SUB[who], ip],
      )
      return (await tx.query<T>(sql, params)).rows
    })
  }

  const rpc = async (who: Who, fn: string, args: string, params: unknown[] = [], ip?: string) =>
    (await as<{ r: unknown }>(who, `select public.${fn}(${args}) as r`, params, ip))[0].r as Record<string, unknown>

  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } })
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
      await db.exec(readFileSync(MIGRATIONS + file, 'utf8'))
    }
    await db.exec(`
      insert into public."user" (id, name, email, "emailVerified", "hasAccess") values
        ('${ADMIN}', 'Admin', 'Admin@Exemple.fr', true, true),
        ('${READER}', 'Lectrice', 'lectrice@exemple.fr', true, true),
        ('${OUTSIDER}', 'Extérieur', 'exterieur@exemple.fr', true, false),
        ('${SUD}', 'Manager Sud', 'Sud@Exemple.fr', true, true),
        ('${NORD}', 'Manager Nord', 'nord@exemple.fr', true, true);
      insert into public.acces (email, role) values ('admin@exemple.fr', 'admin');
    `)
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
      for (const table of ['commerciaux', 'affectations', 'objectifs', 'zones', 'settings', 'acces', 'access_attempts', 'managers', 'structures', 'a_recruter', 'journal', 'user', 'session', 'account', 'verification']) {
        await expect(as('anon', `select * from public."${table}"`), table).rejects.toThrow(/permission denied/)
      }
    })

    it('ne lit pas non plus les tables de connexion une fois connecté', async () => {
      for (const table of ['user', 'session', 'account', 'verification']) {
        await expect(as('admin', `select * from public."${table}"`), table).rejects.toThrow(/permission denied/)
      }
    })

    it('ne peut pas écrire ni appeler les fonctions d\'admin', async () => {
      await expect(as('anon', `insert into public.commerciaux (nom) values ('Pirate')`)).rejects.toThrow(/permission denied/)
      await expect(rpc('anon', 'set_access_code', `'nouveau-code'`)).rejects.toThrow(/permission denied/)
      await expect(rpc('anon', 'save_commercial', `'{"nom":"Pirate"}'::jsonb`)).rejects.toThrow(/permission denied/)
      await expect(rpc('anon', 'is_admin', '')).rejects.toThrow(/permission denied/)
      await expect(rpc('anon', 'list_acces', '')).rejects.toThrow(/permission denied/)
      await expect(rpc('anon', 'map_role', '')).rejects.toThrow(/permission denied/)
      await expect(rpc('anon', 'save_equipe', `gen_random_uuid(), '{}'::jsonb`)).rejects.toThrow(/permission denied/)
      await expect(rpc('anon', 'get_journal', '')).rejects.toThrow(/permission denied/)
      await expect(rpc('anon', 'set_managers_actifs', 'true, false')).rejects.toThrow(/permission denied/)
      await expect(rpc('anon', 'set_recrutement', `'MD', '[]'::jsonb`)).rejects.toThrow(/permission denied/)
      await expect(rpc('anon', 'convertir_a_recruter', `'{}'`)).rejects.toThrow(/permission denied/)
      // Écritures internes : ni un visiteur, ni même un admin connecté ne les appelle
      await expect(rpc('admin', 'noter', `'zone', 'ajout', null, null, null, null, null, null, null`)).rejects.toThrow(/permission denied/)
      await expect(rpc('admin', 'pourvoir', `'MD', '22'`)).rejects.toThrow(/permission denied/)
    })

    it('reçoit not_configured tant qu\'aucun code n\'est défini', async () => {
      expect(await rpc('anon', 'get_map_data', `'peu-importe'`)).toEqual({ ok: false, error: 'not_configured' })
    })
  })

  describe('venus par le portail sans rôle', () => {
    it('ne lisent aucune table directement et ne peuvent rien modifier', async () => {
      await as('postgres', `insert into public.commerciaux (nom) values ('Visible seulement des admins')`)
      for (const who of ['reader', 'outsider'] as const) {
        expect(await as(who, 'select * from public.commerciaux'), who).toEqual([])
        expect(await as(who, 'select * from public.acces'), who).toEqual([])
        await expect(as(who, `insert into public.commerciaux (nom) values ('Intrus')`)).rejects.toThrow(/row-level security/)
        await expect(rpc(who, 'save_commercial', `'{"nom":"Intrus"}'::jsonb`)).rejects.toThrow(/réservé aux admins/)
        await expect(rpc(who, 'set_access_code', `'nouveau-code'`)).rejects.toThrow(/réservé aux admins/)
        await expect(rpc(who, 'list_acces', '')).rejects.toThrow(/réservé aux admins/)
        await expect(as(who, `insert into public.acces (email, role) values ('lectrice@exemple.fr', 'admin')`)).rejects.toThrow(/row-level security/)
        expect(await rpc(who, 'is_admin', '')).toBe(false)
      }
      await as('postgres', `delete from public.commerciaux`)
    })

    it('n\'ont aucun rôle, droit d\'usage ou pas (D-009)', async () => {
      expect(await rpc('reader', 'map_role', '')).toBeNull()
      expect(await rpc('outsider', 'map_role', '')).toBeNull()
      for (const who of ['reader', 'outsider'] as const) {
        await expect(rpc(who, 'save_equipe', `gen_random_uuid(), '{}'::jsonb`)).rejects.toThrow(/réservé aux managers/)
        await expect(rpc(who, 'get_journal', '')).rejects.toThrow(/réservé aux admins et aux managers/)
        await expect(rpc(who, 'set_managers_actifs', 'true, false')).rejects.toThrow(/réservé aux admins/)
        await expect(rpc(who, 'set_recrutement', `'MD', '[]'::jsonb`)).rejects.toThrow(/réservé aux admins/)
        await expect(rpc(who, 'convertir_a_recruter', `'{}'`)).rejects.toThrow(/réservé aux admins/)
        expect(await as(who, 'select * from public.a_recruter')).toEqual([])
        await expect(as(who, 'select * from public.journal')).rejects.toThrow(/permission denied/)
      }
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

    it('supprime un commercial et en crée d\'autres', async () => {
      await as('admin', 'delete from public.commerciaux where id = $1', [id])
      for (const c of [
        { nom: 'Basile Fournier', couleur: '#3cb44b', structures: ['SP'], affectations: [{ structure: 'SP', zone_code: '2A', couverture: 'propre' }] },
        { nom: 'Capucine Delorme', couleur: '#4363d8', structures: ['MD'], affectations: [{ structure: 'MD', zone_code: '98', couverture: 'propre' }] },
      ]) await rpc('admin', 'save_commercial', '$1::jsonb', [JSON.stringify(c)])
      expect((await as<{ nom: string }>('admin', 'select nom from public.commerciaux order by nom')).map((r) => r.nom)).toEqual([
        'Basile Fournier',
        'Capucine Delorme',
      ])
    })

    it('n\'enregistre rien si une zone est invalide, et l\'import Excel n\'existe plus (D-012)', async () => {
      await expect(
        rpc('admin', 'save_commercial', '$1::jsonb', [JSON.stringify({ nom: 'Nouveau', affectations: [{ structure: 'XX', zone_code: '22' }] })]),
      ).rejects.toThrow()
      expect(await as('admin', `select nom from public.commerciaux where nom = 'Nouveau'`)).toEqual([])
      await expect(rpc('admin', 'apply_import', `'[]'::jsonb, '{}'`)).rejects.toThrow(/does not exist/)
    })

    it('ne lit pas directement le hash du code', async () => {
      await expect(as('admin', 'select * from public.settings')).rejects.toThrow(/permission denied/)
    })

    it('ne peut ni retirer ni changer son propre rôle', async () => {
      expect(await as('admin', `delete from public.acces where email = 'admin@exemple.fr' returning email`)).toEqual([])
      expect(await as('admin', `update public.acces set role = 'responsable' where email = 'admin@exemple.fr' returning email`)).toEqual([])
      expect(await rpc('admin', 'is_admin', '')).toBe(true)
    })

    it('nomme et retire les autres admins, par adresse', async () => {
      await as('admin', `insert into public.acces (email, role, created_by) values ('lectrice@exemple.fr', 'admin', public.current_email())`)
      expect(await rpc('reader', 'is_admin', '')).toBe(true)
      const list = await rpc('admin', 'list_acces', '')
      const roles = list.roles as Record<string, unknown>[]
      expect(roles.map((r) => r.email)).toEqual(['admin@exemple.fr', 'lectrice@exemple.fr'])
      expect(roles[1]).toMatchObject({ role: 'admin', name: 'Lectrice', created_by: 'admin@exemple.fr' })
      expect((list.users as Record<string, unknown>[]).find((u) => u.email === 'exterieur@exemple.fr')).toMatchObject({ has_access: false })
      await as('admin', `delete from public.acces where email = 'lectrice@exemple.fr'`)
      expect(await rpc('reader', 'is_admin', '')).toBe(false)
    })

    it('un rôle admin sans droit d\'usage sur le portail ne donne rien', async () => {
      await as('admin', `insert into public.acces (email, role) values ('exterieur@exemple.fr', 'admin')`)
      expect(await rpc('outsider', 'is_admin', '')).toBe(false)
      expect(await rpc('outsider', 'get_map_data', 'null')).toEqual({ ok: false, error: 'not_configured' })
      await as('admin', `delete from public.acces where email = 'exterieur@exemple.fr'`)
    })

    it('refuse une adresse mal écrite ou un rôle inconnu', async () => {
      await expect(as('admin', `insert into public.acces (email, role) values ('Pas Une Adresse', 'admin')`)).rejects.toThrow(/check constraint/)
      await expect(as('admin', `insert into public.acces (email, role) values ('x@exemple.fr', 'superadmin')`)).rejects.toThrow(/check constraint/)
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
      expect(await rpc('outsider', 'get_map_data', 'null')).toEqual({ ok: false, error: 'invalid_code' })
    })

    it('venue par le portail sans rôle, une lectrice passe par le code comme tout le monde (D-009)', async () => {
      expect(await rpc('reader', 'get_map_data', 'null')).toEqual({ ok: false, error: 'invalid_code' })
      expect((await rpc('reader', 'get_map_data', `'Carte-2026!'`)).ok).toBe(true)
    })

    it('bloque après 10 essais ratés, même avec le bon code', async () => {
      for (let i = 0; i < 10; i++) await rpc('anon', 'get_map_data', `'essai-${i}'`)
      expect(await rpc('anon', 'get_map_data', `'Carte-2026!'`)).toEqual({ ok: false, error: 'too_many_attempts' })
      // Une autre adresse IP n'est pas bloquée, ni une personne venue par le portail
      expect((await rpc('anon', 'get_map_data', `'Carte-2026!'`, [], '203.0.113.9')).ok).toBe(true)
      expect((await rpc('admin', 'get_map_data', 'null')).ok).toBe(true)
    })

    it('changer le code remet le compteur à zéro et invalide l\'ancien', async () => {
      await rpc('admin', 'set_access_code', `'Nouveau-code-2027'`)
      expect(await rpc('anon', 'get_map_data', `'Carte-2026!'`)).toEqual({ ok: false, error: 'invalid_code' })
      expect((await rpc('anon', 'get_map_data', `'Nouveau-code-2027'`)).ok).toBe(true)
    })
  })

  describe('managers', () => {
    it('sont créés à la volée par save_commercial (saisie libre)', async () => {
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
      expect(await as('reader', 'select * from public.managers')).toEqual([])
      await expect(as('reader', `insert into public.managers (nom) values ('Pirate')`)).rejects.toThrow(/row-level security/)
      await expect(rpc('reader', 'rename_manager', `'Hélène', 'Pirate'`)).rejects.toThrow(/réservé aux admins/)
    })
  })

  describe('rôle Manager (D-010)', () => {
    const ids: Record<string, string> = {}
    const zonesOf = async (nom: string) =>
      (
        await as<{ z: string }>(
          'postgres',
          `select a.structure || ' ' || a.zone_code || ' ' || a.couverture as z from public.affectations a join public.commerciaux c on c.id = a.commercial_id where c.nom = $1 order by 1`,
          [nom],
        )
      ).map((r) => r.z)
    const chiffresOf = async (nom: string) =>
      as<{ structure: string; annee: number; ca: number | null; objectif: number | null }>(
        'postgres',
        `select o.structure, o.annee, o.ca::float8 as ca, o.objectif::float8 as objectif from public.objectifs o join public.commerciaux c on c.id = o.commercial_id where c.nom = $1 order by o.annee, o.structure`,
        [nom],
      )
    const save = (who: Who, nom: string, patch: unknown) => rpc(who, 'save_equipe', '$1::uuid, $2::jsonb', [ids[nom], JSON.stringify(patch)])
    const zones = (...list: string[]) => ({
      affectations: list.map((z) => {
        const [structure, zone_code, couverture = 'propre'] = z.split(' ')
        return { structure, zone_code, couverture }
      }),
    })

    beforeAll(async () => {
      await as('postgres', `insert into public.managers (nom, structures) values ('Sud', '{MD,SP}'), ('Nord', '{MD}'), ('Ouest', '{MD}') on conflict do nothing`)
      const rows = await as<{ id: string; nom: string }>(
        'postgres',
        `insert into public.commerciaux (nom, manager1, manager2, actif, structures) values
           ('Sud Un', null, 'Sud', true, '{MD,SP,BK}'),
           ('Sud Deux', null, 'Sud', true, '{MD}'),
           ('Sud Parti', null, 'Sud', false, '{MD}'),
           ('Sud Par M1', 'Sud', 'Nord', true, '{MD}'),
           ('Nord Un', null, 'Nord', true, '{MD}')
         returning id, nom`,
      )
      for (const r of rows) ids[r.nom] = r.id
      await as('postgres', `insert into public.affectations (commercial_id, structure, zone_code, couverture) values
        ('${ids['Sud Un']}', 'MD', '13', 'propre'), ('${ids['Sud Un']}', 'BK', '13', 'propre'),
        ('${ids['Sud Parti']}', 'MD', '30', 'propre'),
        ('${ids['Nord Un']}', 'MD', '59', 'propre'), ('${ids['Nord Un']}', 'MD', '75-7', 'partiel')`)
      await as('postgres', `insert into public.objectifs (commercial_id, structure, annee, ca, objectif) values
        ('${ids['Sud Un']}', 'MD', 2026, 100, 200), ('${ids['Nord Un']}', 'MD', 2026, 300, 400)`)
    })

    it('un admin relie un manager à son compte ; un compte, un seul manager ; l\'e-mail de contact ne donne rien', async () => {
      await as('admin', `update public.managers set email = 'sud@exemple.fr' where nom = 'Sud'`)
      expect(await rpc('sud', 'map_role', '')).toBeNull()
      await as('admin', `update public.managers set compte = 'sud@exemple.fr' where nom = 'Sud'`)
      await as('admin', `update public.managers set compte = 'nord@exemple.fr' where nom = 'Nord'`)
      await expect(as('admin', `update public.managers set compte = 'sud@exemple.fr' where nom = 'Ouest'`)).rejects.toThrow(/duplicate key/)
      await expect(as('admin', `update public.managers set compte = 'Sud@Exemple.fr' where nom = 'Ouest'`)).rejects.toThrow(/check constraint/)
      await expect(as('admin', `update public.managers set structures = '{XX}' where nom = 'Ouest'`)).rejects.toThrow(/Structure inconnue/)
      expect(await as('reader', `update public.managers set compte = 'lectrice@exemple.fr' where nom = 'Ouest' returning nom`)).toEqual([])
      expect(await rpc('sud', 'map_role', '')).toBe('manager')
      expect(await rpc('sud', 'mon_manager', '')).toBe('Sud')
      expect(await rpc('sud', 'is_admin', '')).toBe(false)
    })

    it('le rôle « responsable » n\'existe plus', async () => {
      await expect(as('admin', `insert into public.acces (email, role) values ('x@exemple.fr', 'responsable')`)).rejects.toThrow(/check constraint/)
    })

    it('un admin aussi manager reste admin', async () => {
      await as('admin', `update public.managers set compte = 'admin@exemple.fr' where nom = 'Ouest'`)
      expect(await rpc('admin', 'map_role', '')).toBe('admin')
      expect(await rpc('admin', 'mon_manager', '')).toBeNull()
      await expect(save('admin', 'Sud Un', zones())).rejects.toThrow(/réservé aux managers/)
      await as('admin', `update public.managers set compte = null where nom = 'Ouest'`)
    })

    it('ouvre la carte sans code et voit tout, chiffres de toutes les équipes compris, sauf les notes et les comptes', async () => {
      await as('postgres', `update public.commerciaux set notes = 'secret' where nom = 'Sud Un'`)
      const res = await rpc('sud', 'get_map_data', 'null')
      expect(res).toMatchObject({ ok: true, admin: false, chiffres: true, manager: { nom: 'Sud', structures: ['MD', 'SP'] } })
      expect((res.objectifs as { commercial_id: string }[]).map((o) => o.commercial_id)).toEqual(expect.arrayContaining([ids['Sud Un'], ids['Nord Un']]))
      const commerciaux = res.commerciaux as Record<string, unknown>[]
      expect(commerciaux.every((c) => !('notes' in c) && !('actions' in c))).toBe(true)
      expect((res.managers as Record<string, unknown>[]).every((m) => !('compte' in m) && !('structures' in m))).toBe(true)
      // Ses inactifs à lui, pas ceux des autres
      expect(commerciaux.map((c) => c.nom)).toContain('Sud Parti')
      expect(((await rpc('nord', 'get_map_data', 'null')).commerciaux as { nom: string }[]).map((c) => c.nom)).not.toContain('Sud Parti')
      // Un admin voit comptes et structures des managers
      expect(((await rpc('admin', 'get_map_data', 'null')).managers as Record<string, unknown>[]).find((m) => m.nom === 'Sud')).toMatchObject({ compte: 'sud@exemple.fr', structures: ['MD', 'SP'] })
    })

    it('change les départements et le type de ses commerciaux, dans ses structures seulement', async () => {
      await save('sud', 'Sud Un', zones('MD 13 gestion', 'MD 83', 'SP 13'))
      // BK n'est pas à lui : la zone BK reste
      expect(await zonesOf('Sud Un')).toEqual(['BK 13 propre', 'MD 13 gestion', 'MD 83 propre', 'SP 13 propre'])
      await expect(save('sud', 'Sud Un', zones('BK 14'))).rejects.toThrow(/BK n'est pas dans votre périmètre/)
      // MC : structure ni à lui ni au commercial ; SP : à lui, mais pas au commercial
      await expect(save('sud', 'Sud Un', zones('MC 13'))).rejects.toThrow(/MC n'est pas dans votre périmètre/)
      await expect(save('sud', 'Sud Deux', zones('SP 13'))).rejects.toThrow(/SP n'est pas dans votre périmètre/)
      expect(await zonesOf('Sud Un')).toEqual(['BK 13 propre', 'MD 13 gestion', 'MD 83 propre', 'SP 13 propre'])
    })

    it('ne prend pas un département occupé par le commercial d\'un autre manager, quel que soit le type', async () => {
      await expect(save('sud', 'Sud Un', zones('MD 13 gestion', 'MD 83', 'SP 13', 'MD 59'))).rejects.toThrow(/59 \(MD\) est déjà occupé par Nord Un/)
      await expect(save('sud', 'Sud Un', zones('MD 59 partiel'))).rejects.toThrow(/déjà occupé/)
      await expect(save('sud', 'Sud Un', zones('MD 59 gestion_partiel'))).rejects.toThrow(/déjà occupé/)
      // Rien n'est enregistré à moitié
      expect(await zonesOf('Sud Un')).toEqual(['BK 13 propre', 'MD 13 gestion', 'MD 83 propre', 'SP 13 propre'])
      // Le même département dans une autre structure est libre
      await save('sud', 'Sud Un', zones('MD 13 gestion', 'MD 83', 'SP 13', 'SP 59'))
      expect(await zonesOf('Sud Un')).toContain('SP 59 propre')
    })

    it('compare Paris par arrondissement', async () => {
      await expect(save('sud', 'Sud Deux', zones('MD 75'))).rejects.toThrow(/75-7 \(MD\) est déjà occupé/)
      await expect(save('sud', 'Sud Deux', zones('MD 75-7'))).rejects.toThrow(/déjà occupé/)
      await save('sud', 'Sud Deux', zones('MD 75-8'))
      await expect(save('nord', 'Nord Un', zones('MD 59', 'MD 75'))).rejects.toThrow(/75-8 \(MD\) est déjà occupé/)
      await save('sud', 'Sud Deux', zones())
      // Paris entier détaillé par arrondissement : ce n'est pas un nouveau département
      await save('nord', 'Nord Un', zones('MD 59', 'MD 75'))
      const arrs = Array.from({ length: 20 }, (_, i) => `MD 75-${i + 1}`)
      await save('nord', 'Nord Un', zones('MD 59', ...arrs))
      expect((await zonesOf('Nord Un')).length).toBe(21)
      await save('nord', 'Nord Un', zones('MD 59', 'MD 75-7 partiel'))
    })

    it('partage un département entre plusieurs de ses commerciaux', async () => {
      await save('sud', 'Sud Deux', zones('MD 13 partiel'))
      expect(await zonesOf('Sud Deux')).toEqual(['MD 13 partiel'])
    })

    it('garde un partage décidé par un admin, peut en changer le type ou s\'en retirer, pas y revenir', async () => {
      await as('admin', `insert into public.affectations (commercial_id, structure, zone_code, couverture) values ('${ids['Sud Deux']}', 'MD', '59', 'partiel')`)
      await save('sud', 'Sud Deux', zones('MD 13 partiel', 'MD 59 gestion'))
      expect(await zonesOf('Sud Deux')).toEqual(['MD 13 partiel', 'MD 59 gestion'])
      await save('sud', 'Sud Deux', zones('MD 13 partiel'))
      await expect(save('sud', 'Sud Deux', zones('MD 13 partiel', 'MD 59 gestion'))).rejects.toThrow(/déjà occupé/)
    })

    it('un département dont le commercial est inactif est libre', async () => {
      await save('nord', 'Nord Un', zones('MD 59', 'MD 75-7 partiel', 'MD 30'))
      expect(await zonesOf('Nord Un')).toContain('MD 30 propre')
      await save('nord', 'Nord Un', zones('MD 59', 'MD 75-7 partiel'))
    })

    it('un commercial sans manager actif bloque son département : seul un admin y touche', async () => {
      const [{ id }] = await as<{ id: string }>('postgres', `insert into public.commerciaux (nom, structures) values ('Sans manager', '{MD}') returning id`)
      await as('postgres', `insert into public.affectations (commercial_id, structure, zone_code) values ('${id}', 'MD', '66')`)
      await expect(save('sud', 'Sud Deux', zones('MD 13 partiel', 'MD 66'))).rejects.toThrow(/66 \(MD\) est déjà occupé par Sans manager/)
      await as('postgres', `delete from public.commerciaux where id = '${id}'`)
    })

    it('saisit le CA et l\'objectif de ses commerciaux, dans ses structures ; seules les lignes envoyées changent', async () => {
      await save('sud', 'Sud Un', { objectifs: [{ structure: 'SP', annee: 2026, ca: 50, objectif: 80 }] })
      expect(await chiffresOf('Sud Un')).toEqual([
        { structure: 'MD', annee: 2026, ca: 100, objectif: 200 },
        { structure: 'SP', annee: 2026, ca: 50, objectif: 80 },
      ])
      await save('sud', 'Sud Un', { objectifs: [{ structure: 'SP', annee: 2026, ca: null, objectif: null }] })
      expect(await chiffresOf('Sud Un')).toEqual([{ structure: 'MD', annee: 2026, ca: 100, objectif: 200 }])
      await expect(save('sud', 'Sud Un', { objectifs: [{ structure: 'BK', annee: 2026, ca: 1, objectif: 1 }] })).rejects.toThrow(/BK n'est pas dans votre périmètre/)
    })

    it('ne touche pas un commercial hors de son équipe, ni rien d\'autre', async () => {
      await expect(save('sud', 'Nord Un', zones('MD 83'))).rejects.toThrow(/pas dans votre équipe/)
      await expect(save('sud', 'Nord Un', { objectifs: [{ structure: 'MD', annee: 2026, ca: 1, objectif: 1 }] })).rejects.toThrow(/pas dans votre équipe/)
      for (const table of ['commerciaux', 'affectations', 'objectifs', 'acces', 'managers', 'a_recruter']) {
        expect(await as('sud', `select * from public.${table}`), table).toEqual([])
      }
      await expect(as('sud', `insert into public.affectations (commercial_id, structure, zone_code) values ('${ids['Sud Un']}', 'MD', '06')`)).rejects.toThrow(/row-level security/)
      expect(await as('sud', `update public.managers set structures = '{MD,SP,BK}' where nom = 'Sud' returning nom`)).toEqual([])
      await expect(rpc('sud', 'save_commercial', `'{"nom":"Intrus"}'::jsonb`)).rejects.toThrow(/réservé aux admins/)
      await expect(rpc('sud', 'list_acces', '')).rejects.toThrow(/réservé aux admins/)
      await expect(rpc('sud', 'rename_manager', `'Nord', 'Sud'`)).rejects.toThrow(/réservé aux admins/)
      await expect(rpc('sud', 'set_managers_actifs', 'false, true')).rejects.toThrow(/réservé aux admins/)
      await expect(rpc('sud', 'set_recrutement', `'MD', '[]'::jsonb`)).rejects.toThrow(/réservé aux admins/)
      await expect(rpc('sud', 'convertir_a_recruter', `'{}'`)).rejects.toThrow(/réservé aux admins/)
      // Les fonctions d'écriture internes ne contournent pas les règles
      await expect(rpc('sud', 'ecrire_zones', `'${ids['Nord Un']}'::uuid, '[{"structure":"MD","zone_code":"83"}]'::jsonb, '{MD}'`)).rejects.toThrow(/row-level security/)
      await expect(rpc('sud', 'ecrire_chiffres', `'${ids['Nord Un']}'::uuid, '[{"structure":"MD","annee":2030,"ca":1}]'::jsonb`)).rejects.toThrow(/row-level security/)
      expect(await chiffresOf('Nord Un')).toEqual([{ structure: 'MD', annee: 2026, ca: 300, objectif: 400 }])
    })

    it('Manager 1 et Manager 2 se désactivent pour toute la carte, jamais les deux', async () => {
      // Les deux actifs : « Sud Par M1 » est à Sud (Manager 1) et à Nord (Manager 2)
      await save('sud', 'Sud Par M1', zones('MD 84'))
      await save('nord', 'Sud Par M1', zones('MD 84 gestion'))
      await expect(rpc('admin', 'set_managers_actifs', 'false, false')).rejects.toThrow(/doit rester actif/)
      await rpc('admin', 'set_managers_actifs', 'false, true')
      await expect(save('sud', 'Sud Par M1', zones('MD 84'))).rejects.toThrow(/pas dans votre équipe/)
      await save('nord', 'Sud Par M1', zones('MD 84'))
      // Le 84 est désormais à l'équipe de Nord seule
      await expect(save('sud', 'Sud Deux', zones('MD 13 partiel', 'MD 84'))).rejects.toThrow(/déjà occupé/)

      const carte = await rpc('sud', 'get_map_data', 'null')
      expect(carte.settings).toMatchObject({ manager1_actif: false, manager2_actif: true })
      const seen = (carte.commerciaux as { nom: string; manager1: string | null; manager2: string | null }[]).find((c) => c.nom === 'Sud Par M1')
      expect(seen).toMatchObject({ manager1: null, manager2: 'Nord' })
      // Rien n'est effacé : un admin le voit toujours, et tout revient à la réactivation
      const admin = (await rpc('admin', 'get_map_data', 'null')).commerciaux as { nom: string; manager1: string | null }[]
      expect(admin.find((c) => c.nom === 'Sud Par M1')).toMatchObject({ manager1: 'Sud' })
      await rpc('admin', 'set_managers_actifs', 'true, true')
      await save('sud', 'Sud Par M1', zones('MD 84'))
    })

    it('modifie sa propre fiche, une fois reliée (D-013) ; les autres managers n\'y touchent pas, sauf le sien', async () => {
      const [{ id }] = await as<{ id: string }>('postgres', `insert into public.commerciaux (nom, manager2, structures) values ('Sud En Personne', 'Nord', '{MD,BK}') returning id`)
      ids['Sud En Personne'] = id
      await expect(save('sud', 'Sud En Personne', zones('MD 48'))).rejects.toThrow(/pas dans votre équipe/)
      await as('admin', `update public.managers set commercial_id = $1 where nom = 'Sud'`, [id])
      await expect(as('admin', `update public.managers set commercial_id = $1 where nom = 'Ouest'`, [id])).rejects.toThrow(/duplicate key/)
      expect(await as('sud', `update public.managers set commercial_id = null where nom = 'Sud' returning nom`)).toEqual([])

      await save('sud', 'Sud En Personne', zones('MD 48'))
      await save('sud', 'Sud En Personne', { objectifs: [{ structure: 'MD', annee: 2026, ca: 5, objectif: 6 }] })
      expect(await zonesOf('Sud En Personne')).toEqual(['MD 48 propre'])
      await expect(save('sud', 'Sud En Personne', zones('BK 48'))).rejects.toThrow(/BK n'est pas dans votre périmètre/)
      // Son département est à son équipe : il s'y partage, et un autre manager ne le prend pas…
      await save('sud', 'Sud Deux', zones('MD 13 partiel', 'MD 48 partiel'))
      await save('sud', 'Sud Deux', zones('MD 13 partiel'))
      // … sauf le manager de sa fiche, qui est au-dessus
      await save('nord', 'Nord Un', zones('MD 59', 'MD 75-7 partiel', 'MD 48 partiel'))
      await save('nord', 'Nord Un', zones('MD 59', 'MD 75-7 partiel'))
      await as('admin', `update public.commerciaux set manager2 = null where id = $1`, [id])
      await expect(save('nord', 'Nord Un', zones('MD 59', 'MD 75-7 partiel', 'MD 48 partiel'))).rejects.toThrow(/déjà occupé par Sud En Personne/)
      await expect(save('nord', 'Sud En Personne', zones('MD 48'))).rejects.toThrow(/pas dans votre équipe/)

      const carte = await rpc('sud', 'get_map_data', 'null')
      expect((carte.managers as { nom: string; commercial_id: string | null }[]).find((m) => m.nom === 'Sud')?.commercial_id).toBe(id)
      expect(((await rpc('sud', 'get_journal', `1, 50, null, '${id}'::uuid`)).lignes as unknown[]).length).toBeGreaterThan(0)
    })

    it('la fiche d\'un manager se note par son nom, et part avec elle', async () => {
      const lignes = (await rpc('admin', 'get_journal', '1, 500')).lignes as { objet: string; nom: string; apres: Record<string, unknown> | null }[]
      expect(lignes.find((l) => l.objet === 'manager' && l.nom === 'Sud' && l.apres && 'fiche' in l.apres)?.apres).toEqual({ fiche: 'Sud En Personne' })
      await as('admin', `delete from public.commerciaux where id = $1`, [ids['Sud En Personne']])
      expect(await as('admin', `select commercial_id from public.managers where nom = 'Sud'`)).toEqual([{ commercial_id: null }])
    })

    it('le compte suit le manager : renommé, fusionné, supprimé', async () => {
      await rpc('admin', 'rename_manager', `'Sud', 'Sud-Est'`)
      expect(await rpc('sud', 'mon_manager', '')).toBe('Sud-Est')
      await as('admin', `insert into public.managers (nom, structures) values ('Grand Sud', '{BK}')`)
      await rpc('admin', 'rename_manager', `'Sud-Est', 'Grand Sud'`)
      expect(await rpc('sud', 'mon_manager', '')).toBe('Grand Sud')
      expect(await as('admin', `select structures from public.managers where nom = 'Grand Sud'`)).toEqual([{ structures: ['BK', 'MD', 'SP'] }])
      await save('sud', 'Sud Un', zones('MD 13 gestion', 'MD 83', 'SP 13', 'SP 59', 'BK 13'))
      // Une structure au code changé, les managers suivent
      await as('admin', `update public.structures set code = 'BX' where code = 'BK'`)
      expect(await as('admin', `select structures from public.managers where nom = 'Grand Sud'`)).toEqual([{ structures: ['BX', 'MD', 'SP'] }])
      await as('admin', `update public.structures set code = 'BK' where code = 'BX'`)
      await as('admin', `delete from public.managers where nom = 'Grand Sud'`)
      expect(await rpc('sud', 'map_role', '')).toBeNull()
      await expect(save('sud', 'Sud Un', zones())).rejects.toThrow(/réservé aux managers/)
    })

    it('perd tout sans accès sur le portail', async () => {
      await as('postgres', `update public."user" set "hasAccess" = false where id = '${NORD}'`)
      expect(await rpc('nord', 'map_role', '')).toBeNull()
      expect(await rpc('nord', 'get_map_data', 'null')).toMatchObject({ ok: false })
      await expect(save('nord', 'Nord Un', zones())).rejects.toThrow(/réservé aux managers/)
      await as('postgres', `update public."user" set "hasAccess" = true where id = '${NORD}'`)
    })

    it('après tout ça, les commerciaux de test partent', async () => {
      await as('postgres', `delete from public.commerciaux where nom like 'Sud %' or nom like 'Nord %'`)
      await as('postgres', `delete from public.managers where nom in ('Nord', 'Ouest')`)
    })
  })

  describe('départements à recruter (D-011)', () => {
    const aRecruter = async () =>
      (
        await as<{ z: string }>(
          'admin',
          `select structure || ' ' || zone_code || ' ' || coalesce(priorite::text, '-') || ' ' || coalesce(secteur, '-') as z from public.a_recruter order by structure, zone_code`,
        )
      ).map((r) => r.z)
    const set = (structure: string, zones: unknown) => rpc('admin', 'set_recrutement', '$1, $2::jsonb', [structure, JSON.stringify(zones)])
    let id: string

    beforeAll(async () => {
      id = (await rpc('admin', 'save_commercial', '$1::jsonb', [
        JSON.stringify({ nom: 'Occupant', structures: ['MD'], affectations: [{ structure: 'MD', zone_code: '44', couverture: 'partiel' }, { structure: 'MD', zone_code: '75-7', couverture: 'propre' }] }),
      ])) as unknown as string
    })

    it('un admin pose une priorité (1 à 3) et un secteur ; vider les deux efface la ligne', async () => {
      await set('MD', [{ zone_code: '18', priorite: 1, secteur: ' Centre ' }, { zone_code: '36', priorite: null, secteur: 'Centre' }, { zone_code: '41', priorite: 3 }])
      expect(await aRecruter()).toEqual(['MD 18 1 Centre', 'MD 36 - Centre', 'MD 41 3 -'])
      await set('MD', [{ zone_code: '41', priorite: null, secteur: '' }, { zone_code: '18', priorite: 2, secteur: 'Centre' }])
      expect(await aRecruter()).toEqual(['MD 18 2 Centre', 'MD 36 - Centre'])
      await expect(set('MD', [{ zone_code: '18', priorite: 4 }])).rejects.toThrow(/check constraint/)
      await expect(set('XX', [{ zone_code: '18', priorite: 1 }])).rejects.toThrow(/foreign key/)
      await expect(set('MD', 'nope')).rejects.toThrow(/illisible/)
    })

    it('refuse un département occupé, Paris compris ; une autre structure est libre', async () => {
      await expect(set('MD', [{ zone_code: '44', priorite: 1 }])).rejects.toThrow(/44 \(MD\) n'est pas vide/)
      await expect(set('MD', [{ zone_code: '75', priorite: 1 }])).rejects.toThrow(/n'est pas vide/)
      await set('SP', [{ zone_code: '44', priorite: 1 }, { zone_code: '75', priorite: 2 }])
      expect(await aRecruter()).toEqual(['MD 18 2 Centre', 'MD 36 - Centre', 'SP 44 1 -', 'SP 75 2 -'])
    })

    it('part avec la carte, code compris', async () => {
      const res = await rpc('anon', 'get_map_data', `'Nouveau-code-2027'`, [], '203.0.113.99')
      expect(res.a_recruter).toContainEqual({ structure: 'MD', zone_code: '18', priorite: 2, secteur: 'Centre' })
    })

    it('un département pourvu n\'est plus à recruter ; à Paris, les autres arrondissements le restent', async () => {
      await rpc('admin', 'save_commercial', '$1::jsonb', [
        JSON.stringify({ id, structures: ['MD', 'SP'], affectations: [{ structure: 'MD', zone_code: '44' }, { structure: 'MD', zone_code: '18' }, { structure: 'SP', zone_code: '75-7' }] }),
      ])
      const list = await aRecruter()
      expect(list).not.toContain('MD 18 2 Centre')
      expect(list.filter((z) => z.startsWith('SP 75')).length).toBe(19)
      expect(list).not.toContain('SP 75-7 2 -')
      // Et Paris entier redevient une seule ligne, ou s'efface d'un coup
      await rpc('admin', 'save_commercial', '$1::jsonb', [JSON.stringify({ id, affectations: [{ structure: 'MD', zone_code: '44' }] })])
      await set('SP', [{ zone_code: '75', priorite: 1 }])
      expect((await aRecruter()).filter((z) => z.startsWith('SP 75'))).toEqual(['SP 75 1 -'])
      await set('SP', [{ zone_code: '75-1', priorite: 3 }])
      expect((await aRecruter()).filter((z) => z.startsWith('SP 75')).length).toBe(20)
      expect(await aRecruter()).toContain('SP 75-1 3 -')
      await set('SP', [{ zone_code: '75', priorite: null }])
      expect((await aRecruter()).filter((z) => z.startsWith('SP 75'))).toEqual([])
    })

    it('un commercial inactif ne pourvoit rien, sa réactivation oui', async () => {
      await rpc('admin', 'save_commercial', '$1::jsonb', [JSON.stringify({ nom: 'Dormant', actif: false, structures: ['MD'], affectations: [{ structure: 'MD', zone_code: '36' }] })])
      expect(await aRecruter()).toContain('MD 36 - Centre')
      const [{ id: dormant }] = await as<{ id: string }>('admin', `select id from public.commerciaux where nom = 'Dormant'`)
      await rpc('admin', 'save_commercial', '$1::jsonb', [JSON.stringify({ id: dormant, actif: true })])
      expect(await aRecruter()).not.toContain('MD 36 - Centre')
      await as('admin', 'delete from public.commerciaux where id = $1', [dormant])
    })

    it('les fiches « À recruter » deviennent des secteurs ; leurs départements encore occupés n\'en sont pas', async () => {
      const ids: string[] = []
      for (const c of [
        { nom: 'À recruter – Secteur Est', structures: ['MD'], affectations: [{ structure: 'MD', zone_code: '67' }, { structure: 'MD', zone_code: '44' }], objectifs: [{ structure: 'MD', annee: 2026, ca: null, objectif: 900 }] },
        { nom: 'A RECRUTER', statut: 'À recruter', secteur: 'Ouest', structures: ['MD'], affectations: [{ structure: 'MD', zone_code: '35' }] },
        { nom: 'Poste Paris', statut: 'A recruter', structures: ['MD'], affectations: [{ structure: 'MD', zone_code: '75' }] },
      ]) ids.push((await rpc('admin', 'save_commercial', '$1::jsonb', [JSON.stringify(c)])) as unknown as string)
      await rpc('admin', 'save_commercial', '$1::jsonb', [JSON.stringify({ id, affectations: [{ structure: 'MD', zone_code: '44' }, { structure: 'MD', zone_code: '75-7' }] })])

      await expect(rpc('admin', 'convertir_a_recruter', '$1::uuid[]', [[id]])).rejects.toThrow(/n'est pas une fiche/)
      expect(await rpc('admin', 'convertir_a_recruter', '$1::uuid[]', [ids])).toEqual({ fiches: 3, zones: 21 })
      const list = await aRecruter()
      expect(list).toContain('MD 67 - Secteur Est')
      expect(list).toContain('MD 35 - Ouest')
      expect(list.filter((z) => z.startsWith('MD 75-')).length).toBe(19)
      expect(list).not.toContain('MD 75-7 - Poste Paris')
      expect(list.some((z) => z.startsWith('MD 44'))).toBe(false)
      expect(await as('admin', `select nom from public.commerciaux where id = any ($1::uuid[])`, [ids])).toEqual([])

      // Le journal garde ce qui part avec la fiche
      const journal = (await rpc('admin', 'get_journal', `1, 500, null, '${ids[0]}'::uuid`)).lignes as { action: string; avant: Record<string, unknown> }[]
      expect(journal.find((l) => l.action === 'retrait')?.avant).toMatchObject({
        chiffres: [{ structure: 'MD', annee: 2026, ca: null, objectif: 900 }],
      })
      await as('admin', 'delete from public.commerciaux where id = $1', [id])
      await as('admin', 'delete from public.a_recruter where structure is not null')
    })
  })

  describe('journal (D-010)', () => {
    type Ligne = { id: number; lot: number; auteur: string; auteur_nom: string; objet: string; action: string; nom: string; structure: string | null; zone_code: string | null; annee: number | null; avant: Record<string, unknown> | null; apres: Record<string, unknown> | null }
    const journal = async (who: Who = 'admin') => (await rpc(who, 'get_journal', '1, 500')).lignes as Ligne[]
    /** Lignes ajoutées par une action, dans l'ordre. */
    const during = async (fn: () => Promise<unknown>) => {
      const last = (await journal())[0]?.id ?? 0
      await fn()
      return (await journal()).filter((l) => l.id > last).reverse()
    }
    let id: string

    it('note qui, quoi, avant et après ; un enregistrement forme un lot', async () => {
      const lignes = await during(async () => {
        id = (await rpc('admin', 'save_commercial', '$1::jsonb', [
          JSON.stringify({ nom: 'Journal Un', notes: 'privé', structures: ['MD'], manager2: 'Jo', affectations: [{ structure: 'MD', zone_code: '22', couverture: 'partiel' }], objectifs: [{ structure: 'MD', annee: 2026, ca: 10, objectif: 20 }] }),
        ])) as unknown as string
      })
      expect(lignes.map((l) => `${l.objet} ${l.action}`)).toEqual(['manager ajout', 'commercial ajout', 'zone ajout', 'chiffres ajout'])
      expect(new Set(lignes.map((l) => l.lot)).size).toBe(1)
      expect(lignes[2]).toMatchObject({ auteur: 'admin@exemple.fr', auteur_nom: 'Admin', nom: 'Journal Un', structure: 'MD', zone_code: '22', avant: null, apres: { couverture: 'partiel' } })
      expect(lignes[3]).toMatchObject({ annee: 2026, apres: { ca: 10, objectif: 20 } })
    })

    it('réenregistrer sans rien changer n\'ajoute rien ; sinon, seulement ce qui change', async () => {
      const same = { id, nom: 'Journal Un', notes: 'privé', structures: ['MD'], affectations: [{ structure: 'MD', zone_code: '22', couverture: 'partiel' }], objectifs: [{ structure: 'MD', annee: 2026, ca: 10, objectif: 20 }, { structure: 'MD', annee: 2025, ca: null, objectif: null }] }
      expect(await during(() => rpc('admin', 'save_commercial', '$1::jsonb', [JSON.stringify(same)]))).toEqual([])
      const lignes = await during(() =>
        rpc('admin', 'save_commercial', '$1::jsonb', [
          JSON.stringify({ ...same, statut: 'VRP', affectations: [{ structure: 'MD', zone_code: '22', couverture: 'propre' }, { structure: 'MD', zone_code: '35' }], objectifs: [{ structure: 'MD', annee: 2026, ca: 15, objectif: 20 }] }),
        ]),
      )
      expect(lignes.map((l) => [l.objet, l.action, l.zone_code, l.avant, l.apres])).toEqual([
        ['commercial', 'modification', null, { statut: null }, { statut: 'VRP' }],
        ['zone', 'modification', '22', { couverture: 'partiel' }, { couverture: 'propre' }],
        ['zone', 'ajout', '35', null, { couverture: 'propre' }],
        ['chiffres', 'modification', null, { ca: 10 }, { ca: 15 }],
      ])
    })

    it('note les managers, les rôles, les structures et les réglages, jamais le code d\'accès', async () => {
      const lignes = await during(async () => {
        await as('admin', `update public.managers set compte = 'sud@exemple.fr', structures = '{MD}' where nom = 'Jo'`)
        await as('admin', `insert into public.acces (email, role) values ('autre@exemple.fr', 'admin')`)
        await as('admin', `delete from public.acces where email = 'autre@exemple.fr'`)
        await rpc('admin', 'set_managers_actifs', 'false, true')
        await rpc('admin', 'set_managers_actifs', 'true, true')
        await rpc('admin', 'set_access_code', `'Code-secret-2028'`)
      })
      expect(lignes.map((l) => `${l.objet} ${l.action}`)).toEqual(['manager modification', 'acces ajout', 'acces retrait', 'reglage modification', 'reglage modification', 'reglage modification'])
      expect(lignes[0]).toMatchObject({ nom: 'Jo', avant: { compte: null, structures: [] }, apres: { compte: 'sud@exemple.fr', structures: ['MD'] } })
      expect(JSON.stringify(lignes)).not.toMatch(/Code-secret|\$2[aby]\$/)
      await rpc('admin', 'set_access_code', `'Nouveau-code-2027'`)
    })

    it('une suite automatique n\'ajoute rien : renommer un manager ou une structure fait une ligne', async () => {
      expect((await during(() => rpc('admin', 'rename_manager', `'Jo', 'Jo B.'`))).map((l) => `${l.objet} ${l.action} ${l.nom}`)).toEqual(['manager modification Jo B.'])
      await as('admin', `insert into public.structures (code, nom, ordre) values ('ZZ', 'Test', 9)`)
      await rpc('admin', 'save_commercial', '$1::jsonb', [JSON.stringify({ id, structures: ['MD', 'ZZ'], affectations: [{ structure: 'MD', zone_code: '22' }, { structure: 'ZZ', zone_code: '22' }] })])
      expect((await during(() => as('admin', `update public.structures set code = 'ZY' where code = 'ZZ'`))).map((l) => `${l.objet} ${l.action} ${l.nom}`)).toEqual(['structure modification ZY'])
      expect((await during(() => as('admin', `delete from public.structures where code = 'ZY'`))).map((l) => `${l.objet} ${l.action} ${l.nom}`)).toEqual(['structure retrait ZY'])
    })

    it('un manager lit le journal de son équipe, sans les champs réservés aux admins', async () => {
      await rpc('admin', 'save_commercial', '$1::jsonb', [JSON.stringify({ id, notes: 'encore plus privé' })])
      await rpc('admin', 'save_commercial', '$1::jsonb', [JSON.stringify({ nom: 'Ailleurs', structures: ['MD'] })])
      const mine = await rpc('sud', 'save_equipe', '$1::uuid, $2::jsonb', [id, JSON.stringify({ objectifs: [{ structure: 'MD', annee: 2027, ca: 1, objectif: 2 }] })]).then(() => journal('sud'))
      expect(mine[0]).toMatchObject({ auteur: 'sud@exemple.fr', objet: 'chiffres', annee: 2027 })
      expect(new Set(mine.map((l) => l.nom))).toEqual(new Set(['Journal Un']))
      expect(JSON.stringify(mine)).not.toMatch(/privé/)
      expect(mine.some((l) => ['manager', 'acces', 'reglage'].includes(l.objet))).toBe(false)
    })

    it('se lit par pages d\'enregistrements entiers, avec une recherche sur tout', async () => {
      type Page = { lignes: Ligne[]; total: number; page: number; taille: number }
      const read = async (args: string, who: Who = 'admin') => (await rpc(who, 'get_journal', args)) as unknown as Page
      const first = await read('1, 3')
      expect(first).toMatchObject({ page: 1, taille: 3 })
      expect(new Set(first.lignes.map((l) => l.lot)).size).toBe(3)
      const second = await read('2, 3')
      expect(second.lignes[0].id).toBeLessThan(first.lignes.at(-1)!.id)
      expect(second.total).toBe(first.total)
      // Toutes les pages réunies redonnent tout, sans doublon ni enregistrement coupé
      const all = await journal()
      const pages = await Promise.all(Array.from({ length: Math.ceil(first.total / 7) }, (_, i) => read(`${i + 1}, 7`)))
      expect(pages.flatMap((p) => p.lignes.map((l) => l.id))).toEqual(all.map((l) => l.id))
      expect((await read('999, 3')).lignes).toEqual([])

      // Par nom, auteur, département (numéro ou nom) ; % et _ se cherchent tels quels
      expect((await read(`1, 50, 'journal un'`)).total).toBeGreaterThan(0)
      expect((await read(`1, 50, 'sud@exemple'`)).lignes.some((l) => l.auteur === 'sud@exemple.fr')).toBe(true)
      expect((await read(`1, 50, 'Ille-et-Vilaine'`)).lignes.some((l) => l.zone_code === '35')).toBe(true)
      expect((await read(`1, 50, '%'`)).total).toBe(0)
      expect((await read(`1, 50, 'rien de tel'`))).toMatchObject({ total: 0, lignes: [] })
      // Un manager ne retrouve pas par la recherche ce qu'il ne peut pas lire
      expect((await read(`1, 50, 'privé'`)).total).toBeGreaterThan(0)
      expect((await read(`1, 50, 'privé'`, 'sud')).total).toBe(0)
    })

    it('garde un commercial supprimé avec ses zones et ses chiffres', async () => {
      const removed = await during(() => as('admin', 'delete from public.commerciaux where id = $1', [id]))
      expect(removed).toHaveLength(1)
      expect(removed[0]).toMatchObject({ objet: 'commercial', action: 'retrait', nom: 'Journal Un' })
      expect((removed[0].avant as { zones: unknown[]; chiffres: unknown[] }).zones).toEqual([{ structure: 'MD', zone_code: '22', couverture: 'propre' }])
      expect((removed[0].avant as { chiffres: unknown[] }).chiffres.length).toBe(2)
      await as('admin', `delete from public.commerciaux where nom = 'Ailleurs'`)
      await as('admin', `delete from public.managers where nom = 'Jo B.'`)
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
      expect(await as('reader', 'select * from public.structures')).toEqual([])
      await expect(as('reader', `insert into public.structures (code, nom) values ('PI', 'Pirate')`)).rejects.toThrow(/row-level security/)
      await expect(as('anon', `insert into public.structures (code, nom) values ('PI', 'Pirate')`)).rejects.toThrow(/permission denied/)
      await expect(rpc('reader', 'reorder_structures', `array['BK']`)).rejects.toThrow(/réservé aux admins/)
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

  describe('couvertures', () => {
    it('acceptent propre, partiel, gestion et gestion-partiel, et rien d\'autre', async () => {
      const id = (await rpc('admin', 'save_commercial', '$1::jsonb', [
        JSON.stringify({
          nom: 'Couverture Test',
          structures: ['MD'],
          affectations: [
            { structure: 'MD', zone_code: '22', couverture: 'propre' },
            { structure: 'MD', zone_code: '29', couverture: 'partiel' },
            { structure: 'MD', zone_code: '35', couverture: 'gestion' },
            { structure: 'MD', zone_code: '56', couverture: 'gestion_partiel' },
          ],
        }),
      ])) as unknown as string
      const rows = await as<{ couverture: string }>('admin', `select couverture from public.affectations where commercial_id = $1 order by zone_code`, [id])
      expect(rows.map((r) => r.couverture)).toEqual(['propre', 'partiel', 'gestion', 'gestion_partiel'])
      await expect(
        rpc('admin', 'save_commercial', '$1::jsonb', [JSON.stringify({ id, affectations: [{ structure: 'MD', zone_code: '22', couverture: 'moitie' }] })]),
      ).rejects.toThrow(/check constraint/)
      await as('admin', `delete from public.commerciaux where id = $1`, [id])
    })
  })

  describe('mode des zones partagées par défaut', () => {
    it('vaut « rayures » et part avec la carte', async () => {
      const res = await rpc('admin', 'get_map_data', 'null')
      expect(res.settings).toMatchObject({ default_shared_mode: 'rayures' })
    })

    it('un admin le change, pour tout le monde', async () => {
      await rpc('admin', 'set_default_shared_mode', `'decoupage'`)
      const visitor = await rpc('anon', 'get_map_data', `'Nouveau-code-2027'`)
      expect(visitor.settings).toMatchObject({ default_shared_mode: 'decoupage' })
    })

    it('refuse un mode inconnu et les non-admins', async () => {
      await expect(rpc('admin', 'set_default_shared_mode', `'paillettes'`)).rejects.toThrow(/Mode inconnu/)
      await expect(rpc('reader', 'set_default_shared_mode', `'rayures'`)).rejects.toThrow(/réservé aux admins/)
      await expect(rpc('anon', 'set_default_shared_mode', `'rayures'`)).rejects.toThrow(/permission denied/)
    })
  })

  describe('fonctions', () => {
    // Garde-fou repris de Supabase (extension safeupdate) : un DELETE ou un UPDATE sans WHERE est toujours une erreur
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

})

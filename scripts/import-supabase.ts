// Reprise des données de Supabase Cloud dans la nouvelle base (MIGRATION.md, étape 6).
//
//   SUPABASE_DB_URL=… GD_MAP_DATABASE_URL=… node scripts/import-supabase.ts [--ecrire]
//
// Sans --ecrire : lit les deux bases et dit ce qui serait copié, sans rien changer. Avec --ecrire :
// remplace, en une transaction, les structures, managers, commerciaux, zones attribuées et CA/objectifs,
// reprend le code d'accès (son hash bcrypt : le code ne change pas) et le mode d'affichage, et donne le
// rôle admin aux admins Supabase, par adresse. Les comptes Supabase, eux, ne sont pas repris : chacun se
// connecte désormais par le portail (D-002).
import pg from 'pg'

const source = process.env.SUPABASE_DB_URL
const target = process.env.GD_MAP_DATABASE_URL
const write = process.argv.includes('--ecrire')
if (!source || !target) {
  console.error('SUPABASE_DB_URL et GD_MAP_DATABASE_URL sont nécessaires')
  process.exit(1)
}

// Dans l'ordre des dépendances : structures et managers avant les commerciaux, puis leurs zones et chiffres
const TABLES = ['structures', 'managers', 'commerciaux', 'affectations', 'objectifs'] as const

const from = new pg.Client({ connectionString: source, ssl: source.includes('supabase.com') ? { rejectUnauthorized: false } : undefined })
const to = new pg.Client({ connectionString: target })
await from.connect()
await to.connect()

const rows = async (client: pg.Client, sql: string) => (await client.query(sql)).rows

try {
  const data: Record<string, unknown[]> = {}
  for (const table of TABLES) {
    data[table] = (await rows(from, `select coalesce(json_agg(t), '[]'::json) as r from public.${table} t`))[0].r
  }
  const [settings] = await rows(from, 'select access_code_hash, access_code_updated_at, default_shared_mode from public.settings where id = 1')
  const admins = await rows(from, 'select lower(btrim(email)) as email, created_at from public.admins')

  // Les zones viennent des migrations : les deux bases doivent avoir exactement les mêmes codes
  const zonesOf = async (client: pg.Client) => (await rows(client, 'select code from public.zones order by code')).map((r) => r.code).join(',')
  if ((await zonesOf(from)) !== (await zonesOf(to))) throw new Error('Les zones diffèrent entre Supabase et la nouvelle base : arrêt')

  console.log('À copier depuis Supabase :')
  for (const table of TABLES) console.log(`  ${table.padEnd(13)} ${data[table].length}`)
  console.log(`  code d'accès  ${settings?.access_code_hash ? 'défini (repris tel quel)' : 'non défini'}`)
  console.log(`  admins        ${admins.map((a) => a.email).join(', ') || 'aucun'}`)

  if (!write) {
    console.log('\nRien n\'a été écrit. Relancer avec --ecrire pour copier.')
  } else {
    await to.query('begin')
    // Remplace ce que la nouvelle base contient déjà (les quatre structures d'origine, des essais…)
    await to.query('truncate public.affectations, public.objectifs, public.commerciaux, public.managers, public.structures')
    for (const table of TABLES) {
      await to.query(`insert into public.${table} select * from json_populate_recordset(null::public.${table}, $1::json)`, [JSON.stringify(data[table])])
    }
    if (settings) {
      await to.query(
        `update public.settings set access_code_hash = $1, access_code_updated_at = $2, access_code_updated_by = null, default_shared_mode = $3 where id = 1`,
        [settings.access_code_hash, settings.access_code_updated_at, settings.default_shared_mode],
      )
    }
    for (const admin of admins) {
      await to.query(
        `insert into public.acces (email, role, created_at, created_by) values ($1, 'admin', $2, 'reprise Supabase') on conflict (email) do nothing`,
        [admin.email, admin.created_at],
      )
    }
    await to.query('delete from public.access_attempts')
    await to.query('commit')

    console.log('\nCopié. Vérification dans la nouvelle base :')
    for (const table of TABLES) {
      const [{ n }] = await rows(to, `select count(*)::int as n from public.${table}`)
      console.log(`  ${table.padEnd(13)} ${n}${n === data[table].length ? '' : `  ≠ ${data[table].length} attendus`}`)
    }
  }
} catch (error) {
  await to.query('rollback').catch(() => undefined)
  console.error(`Échec, rien n'a été écrit : ${(error as Error).message}`)
  process.exitCode = 1
} finally {
  await from.end()
  await to.end()
}

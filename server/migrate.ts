import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type pg from 'pg'

/** Les migrations SQL, dans l'ordre de leur nom (horodatage). */
export function migrationFiles(dir: string) {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({ version: file.replace(/\.sql$/, ''), sql: readFileSync(join(dir, file), 'utf8') }))
}

/**
 * Applique les migrations qui manquent, chacune dans sa transaction, sous un verrou : deux conteneurs
 * qui démarrent ensemble n'appliquent jamais la même migration deux fois.
 */
export async function migrate(pool: pg.Pool, dir: string, log: (line: string) => void = console.log) {
  const client = await pool.connect()
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', ['gd-map:migrations'])
    await client.query(`create schema if not exists app`)
    await client.query(`create table if not exists app.schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )`)
    const { rows } = await client.query<{ version: string }>('select version from app.schema_migrations')
    const applied = new Set(rows.map((r) => r.version))
    for (const { version, sql } of migrationFiles(dir)) {
      if (applied.has(version)) continue
      try {
        await client.query('begin')
        await client.query(sql)
        await client.query('insert into app.schema_migrations (version) values ($1)', [version])
        await client.query('commit')
        log(`[migrations] ${version} appliquée`)
      } catch (error) {
        await client.query('rollback').catch(() => undefined)
        throw new Error(`Migration ${version} en échec : ${(error as Error).message}`, { cause: error })
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock(hashtext($1))', ['gd-map:migrations']).catch(() => undefined)
    client.release()
  }
}

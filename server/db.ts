import pg from 'pg'

export interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>
}

/** Qui fait la requête : l'utilisateur de la session (ou personne) et son adresse IP. */
export interface Visitor {
  userId: string | null
  ip: string
}

export interface Db extends Queryable {
  /**
   * Une requête de l'API, dans sa propre transaction, avec les droits du visiteur : rôle `anon` sans
   * session, `authenticated` avec. Les règles RLS et les fonctions SQL décident ensuite (D-003).
   */
  as<T>(visitor: Visitor, fn: (q: Queryable) => Promise<T>): Promise<T>
}

/** Pose le rôle, l'utilisateur et l'IP pour la seule transaction en cours (troisième argument à true). */
export const VISITOR_SETTINGS = `select set_config('role', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('app.client_ip', $3, true)`

export const visitorParams = (v: Visitor) => [v.userId ? 'authenticated' : 'anon', v.userId ?? '', v.ip]

// numeric (CA, objectifs, jours par an) en nombre plutôt qu'en texte, comme le renvoyait Supabase
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value))

export function createPool(connectionString: string) {
  return new pg.Pool({ connectionString, max: 10 })
}

/** Requête sur le pool ou sur un client de transaction, sous la forme commune aux tests (PGlite). */
const runner =
  (target: pg.Pool | pg.PoolClient): Queryable['query'] =>
  async <R,>(text: string, params?: unknown[]) => ({ rows: (await target.query(text, params)).rows as R[] })

export function pgDb(pool: pg.Pool): Db {
  return {
    query: runner(pool),
    async as(visitor, fn) {
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query(VISITOR_SETTINGS, visitorParams(visitor))
        const result = await fn({ query: runner(client) })
        await client.query('commit')
        return result
      } catch (error) {
        await client.query('rollback').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },
  }
}

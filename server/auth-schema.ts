// Configuration lue par la CLI de Better Auth (`npm run auth:schema`) pour écrire les tables de
// connexion en SQL. Mêmes options que le serveur ; un fournisseur factice suffit, rien n'est appelé.
import { createAuth } from './auth.ts'
import { createPool } from './db.ts'

export const auth = createAuth({
  pool: createPool(process.env.GD_MAP_DATABASE_URL ?? 'postgres://localhost/gd_map'),
  baseUrl: 'http://localhost:5173',
  secret: 'schema-only-schema-only-schema-only-0000',
  oidc: { issuer: 'http://localhost:3400', clientId: 'schema-only', clientSecret: '' },
})

import { describe, expect, it } from 'vitest'
import { readEnv } from './env.ts'

const base = {
  GD_MAP_BASE_URL: 'https://carte.gdone.fr/',
  GD_MAP_DATABASE_URL: 'postgres://gd:gd@db:5432/gd_map',
  GD_MAP_AUTH_SECRET: 'x'.repeat(32),
  GD_MAP_OIDC_ISSUER: 'https://portail.gdone.fr/',
  GD_MAP_OIDC_CLIENT_ID: 'gd-map',
  GD_MAP_OIDC_CLIENT_SECRET: 'secret',
}

describe('configuration du serveur', () => {
  it('lit la production', () => {
    const env = readEnv({ ...base, NODE_ENV: 'production', GD_MAP_ADMINS: ' Admin@Exemple.fr , b@exemple.fr,' })
    expect(env).toMatchObject({
      production: true,
      port: 3600,
      baseUrl: 'https://carte.gdone.fr',
      oidc: { issuer: 'https://portail.gdone.fr', clientId: 'gd-map', clientSecret: 'secret' },
      admins: ['admin@exemple.fr', 'b@exemple.fr'],
      devSession: null,
    })
  })

  it('refuse un secret trop court, une adresse d’admin illisible, et l’oubli du portail', () => {
    expect(() => readEnv({ ...base, GD_MAP_AUTH_SECRET: 'court' })).toThrow(/32 caractères/)
    expect(() => readEnv({ ...base, GD_MAP_ADMINS: 'pas-une-adresse' })).toThrow(/illisible/)
    expect(() => readEnv({ ...base, GD_MAP_OIDC_ISSUER: '' })).toThrow(/portail non configurée/)
    expect(() => readEnv({ ...base, NODE_ENV: 'production', GD_MAP_OIDC_CLIENT_SECRET: '' })).toThrow(/CLIENT_SECRET/)
  })

  it('accepte une session locale en développement, jamais en production', () => {
    const dev = { ...base, GD_MAP_OIDC_ISSUER: '', GD_MAP_OIDC_CLIENT_ID: '', GD_MAP_DEV_SESSION: 'Moi@Exemple.fr' }
    expect(readEnv(dev)).toMatchObject({ oidc: null, devSession: 'moi@exemple.fr' })
    expect(() => readEnv({ ...dev, NODE_ENV: 'production' })).toThrow(/refusée en production/)
  })
})

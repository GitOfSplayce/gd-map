// Configuration du serveur, lue une seule fois au démarrage. Toutes les variables commencent par GD_MAP_,
// et les noms OIDC sont ceux qu'affiche le guide de branchement du portail (GD_MAP_OIDC_*).

export interface OidcConfig {
  /** Émetteur : l'adresse du portail GDCOM (https://portail.gdone.fr). */
  issuer: string
  clientId: string
  /** Vide pour un client `native` de développement (PKCE sans secret). */
  clientSecret: string
}

export interface ServerEnv {
  production: boolean
  port: number
  /** Adresse publique de la carte : origine de confiance et base de l'adresse de retour OIDC. */
  baseUrl: string
  databaseUrl: string
  authSecret: string
  /** Absent seulement en développement avec une session locale. */
  oidc: OidcConfig | null
  /** Premiers admins, ajoutés au démarrage s'ils n'ont pas encore de rôle (D-002). */
  admins: string[]
  /** Session locale de développement, sans portail : l'adresse de la personne simulée. */
  devSession: string | null
  /** Dossier du site construit par Vite. */
  staticRoot: string
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function readEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const get = (name: string) => source[name]?.trim() || undefined
  const required = (name: string) => {
    const value = get(name)
    if (!value) throw new Error(`Variable manquante : ${name}`)
    return value
  }

  const production = source.NODE_ENV === 'production'
  const baseUrl = required('GD_MAP_BASE_URL').replace(/\/$/, '')
  const authSecret = required('GD_MAP_AUTH_SECRET')
  if (authSecret.length < 32) throw new Error('GD_MAP_AUTH_SECRET doit faire au moins 32 caractères')

  const admins = (get('GD_MAP_ADMINS') ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
  const invalid = admins.find((email) => !EMAIL.test(email))
  if (invalid) throw new Error(`GD_MAP_ADMINS : adresse illisible « ${invalid} »`)

  const devSession = get('GD_MAP_DEV_SESSION')?.toLowerCase() ?? null
  if (devSession && production) throw new Error('GD_MAP_DEV_SESSION est refusée en production')
  if (devSession && !EMAIL.test(devSession)) throw new Error('GD_MAP_DEV_SESSION doit être une adresse e-mail')

  const issuer = get('GD_MAP_OIDC_ISSUER')
  const clientId = get('GD_MAP_OIDC_CLIENT_ID')
  const oidc = issuer && clientId ? { issuer: issuer.replace(/\/$/, ''), clientId, clientSecret: get('GD_MAP_OIDC_CLIENT_SECRET') ?? '' } : null
  if (!oidc && !devSession) {
    throw new Error('Connexion par le portail non configurée : GD_MAP_OIDC_ISSUER et GD_MAP_OIDC_CLIENT_ID (ou GD_MAP_DEV_SESSION en développement)')
  }
  if (oidc && production && !oidc.clientSecret) throw new Error('GD_MAP_OIDC_CLIENT_SECRET est obligatoire en production')

  const port = Number(get('PORT') ?? '3600')
  if (!Number.isInteger(port) || port <= 0) throw new Error('PORT illisible')

  return {
    production,
    port,
    baseUrl,
    databaseUrl: required('GD_MAP_DATABASE_URL'),
    authSecret,
    oidc,
    admins,
    devSession,
    staticRoot: get('GD_MAP_STATIC_ROOT') ?? 'dist',
  }
}

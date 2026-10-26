import { betterAuth } from 'better-auth'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import type pg from 'pg'
import type { OidcConfig } from './env.ts'
import { ORGANIZATIONS_CLAIM, hasMapEntitlement } from './organizations.ts'

// Connexion par le portail GDCOM (D-002), construite comme celle de la flotte (gdcom-flotte,
// src/lib/auth/options.ts) : Better Auth en client OIDC `genericOAuth`, code + PKCE, ID token vérifié.
// Rien du protocole n'est écrit ici : découverte, PKCE, vérification et rotation des clés sont l'affaire
// de Better Auth et du portail.

const HOUR = 60 * 60
const DAY = 24 * HOUR

/** Identifiant du fournisseur, tel qu'il apparaît dans l'adresse de retour. */
export const OIDC_PROVIDER_ID = 'gdcom'

/** Adresse de retour à déclarer sur le client OAuth du portail (`/callback/:id` de Better Auth 1.7). */
export const OIDC_CALLBACK_PATH = `/api/auth/callback/${OIDC_PROVIDER_ID}`

/**
 * `organizations` porte le claim d'adhésions et de droits d'usage. Pas d'`offline_access` : la carte
 * n'appelle jamais le portail après la connexion, elle n'a pas à garder de jeton de rafraîchissement.
 */
export const OIDC_SCOPES = ['openid', 'profile', 'email', 'organizations']

type Fields = Record<string, unknown>

/**
 * `hasAccess` et `idpUserId` ne s'écrivent qu'au retour du portail (route /callback/:id de Better Auth),
 * jamais depuis une autre route : personne ne se donne l'accès à la carte en modifiant son profil.
 */
async function portalFieldsFromCallbackOnly<T extends Fields>(user: T, context: { path?: string } | null) {
  if (context?.path?.startsWith('/callback/')) return
  const { hasAccess: _hasAccess, idpUserId: _idpUserId, ...rest } = user
  return { data: rest as T }
}

export interface AuthDependencies {
  pool: pg.Pool
  baseUrl: string
  secret: string
  /** Absent : session locale de développement, aucun fournisseur déclaré. */
  oidc: OidcConfig | null
}

export function createAuth(deps: AuthDependencies) {
  return betterAuth({
    appName: 'Carte commerciale',
    baseURL: deps.baseUrl,
    basePath: '/api/auth',
    secret: deps.secret,
    database: deps.pool,
    trustedOrigins: [new URL(deps.baseUrl).origin],

    // Aucun compte propre à la carte : on ne connaît une personne que par le portail.
    emailAndPassword: { enabled: false },
    // Le profil vient du portail et de lui seul : personne ne modifie le sien ici (hasAccess compris).
    disabledPaths: ['/update-user', '/change-email', '/delete-user', '/change-password', '/set-password', '/link-social', '/unlink-account'],

    // Les jetons du portail ne servent qu'à la connexion : chiffrés en base, au cas où elle fuirait.
    account: { encryptOAuthTokens: true },

    session: {
      expiresIn: 7 * DAY,
      updateAge: DAY,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },

    user: {
      additionalFields: {
        /** Claim `sub` du portail : l'identité de la personne chez lui. */
        idpUserId: { type: 'string', required: false, input: true },
        /**
         * Une de ses organisations a le droit d'usage `gd-map` : relu à chaque connexion. Sans lui, la
         * personne n'est ni lectrice ni admin, même avec un rôle dans `acces`.
         */
        hasAccess: { type: 'boolean', required: false, defaultValue: false, input: true },
      },
    },

    databaseHooks: {
      // `input: true` laisse mapProfileToUser écrire ces deux champs ; le garde ci-dessous les refuse
      // partout ailleurs qu'au retour du portail.
      user: {
        create: { before: portalFieldsFromCallbackOnly },
        update: { before: portalFieldsFromCallbackOnly },
      },
      // L'ID token n'a plus d'usage une fois la session ouverte, et Better Auth ne le chiffre pas : on
      // ne le garde pas.
      account: {
        create: { before: async (account) => ({ data: { ...account, idToken: null } }) },
        update: { before: async (account) => ('idToken' in account ? { data: { ...account, idToken: null } } : undefined) },
      },
    },

    advanced: {
      cookiePrefix: 'gd-map',
      // Des UUID : les fonctions SQL lisent l'utilisateur avec auth.uid(), qui renvoie un uuid.
      database: { generateId: 'uuid' },
    },

    plugins: deps.oidc
      ? [
          genericOAuth({
            config: [
              {
                providerId: OIDC_PROVIDER_ID,
                name: 'Portail GDCOM',
                discoveryUrl: `${deps.oidc.issuer}/.well-known/openid-configuration`,
                clientId: deps.oidc.clientId,
                // Les clients confidentiels du support sont déclarés en client_secret_basic, comme celui du
                // studio de lummea-play ; un client `native` de développement n'a pas de secret.
                ...(deps.oidc.clientSecret ? { clientSecret: deps.oidc.clientSecret, authentication: 'basic' as const } : {}),
                scopes: OIDC_SCOPES,
                redirectURI: `${deps.baseUrl}${OIDC_CALLBACK_PATH}`,
                // OAuth 2.1 : code + PKCE, y compris pour le client `web` de production.
                pkce: true,
                // Le claim d'organisations décide de qui entre : jamais de jeton décodé sans vérification.
                requireIdTokenVerification: true,
                // Droits d'usage et profil changent côté portail : chaque connexion les réécrit.
                overrideUserInfo: true,
                mapProfileToUser: (profile) => {
                  const sub = profile.sub
                  return {
                    idpUserId: typeof sub === 'string' ? sub : typeof sub === 'number' ? String(sub) : undefined,
                    hasAccess: hasMapEntitlement(profile[ORGANIZATIONS_CLAIM]),
                  }
                },
              },
            ],
          }),
        ]
      : [],
  })
}

export type Auth = ReturnType<typeof createAuth>

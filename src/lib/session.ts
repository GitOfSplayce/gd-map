import { api } from './api'

// Connexion par le portail GDCOM (D-002) : Better Auth côté serveur, quelques appels ici.

export const isDemo = import.meta.env.VITE_DEMO === '1'

export type SessionRole = 'admin' | 'lecteur'

export interface Me {
  user: { email: string; name: string; image: string | null } | null
  /** null : pas connecté, ou connecté sans droit d'usage `gd-map` sur le portail. */
  role: SessionRole | null
  /** Le portail, où se gèrent mot de passe, passkeys et double authentification. */
  portalUrl: string | null
}

const SIGNED_OUT: Me = { user: null, role: null, portalUrl: null }

export async function fetchMe(): Promise<Me> {
  if (isDemo) return { user: { email: 'demo@exemple.fr', name: 'Démo', image: null }, role: 'admin', portalUrl: null }
  try {
    return await api<Me>('GET', '/moi')
  } catch {
    return SIGNED_OUT
  }
}

/** Paramètre ajouté à l'adresse de retour quand le portail n'a pas pu ouvrir la session. */
export const SIGN_IN_FAILED = 'connexion'

/**
 * Part vers le portail par l'entrée de la carte (`/api/connexion`, celle qu'ouvre la tuile de GD One) ;
 * au retour, la session est ouverte et l'on revient sur `returnTo` (un chemin de la carte : `/`,
 * `/admin`). Un échec revient avec `?connexion=echec`, que l'écran affiche.
 */
export async function signIn(returnTo: string) {
  window.location.assign(`/api/connexion?retour=${encodeURIComponent(returnTo)}`)
}

/** Ferme la session de la carte (celle du portail reste ouverte). */
export async function signOut() {
  if (isDemo) return
  await api('POST', '/auth/sign-out', {})
}

/** Vrai si l'adresse courante revient d'une connexion manquée. */
export const signInFailed = () => new URLSearchParams(window.location.search).get(SIGN_IN_FAILED) === 'echec'

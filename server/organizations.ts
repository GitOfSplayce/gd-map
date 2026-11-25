// Lecture du claim d'organisations du portail (gdcom-portail, src/lib/oidc/claims.ts).
//
// Pour chaque adhésion de la personne, le portail y place le droit d'usage de l'application cliente,
// déjà filtré sur `gd-map` d'après `metadata.app` du client OAuth. L'organisation opératrice (GDCOM)
// a toujours le sien (gdcom-portail, D-017). gd-map n'en tire qu'une chose : la porte d'entrée.
// Ce que la personne peut faire ensuite vient de gd-map : admin (table `acces`) ou manager relié à son
// compte (`managers.compte`).

export const ORGANIZATIONS_CLAIM = 'urn:gdcom:organizations'

/** Accès donné par le portail à la personne elle-même, sans passer par une organisation (D-010) : `true`, ou absent. */
export const PERSONAL_ACCESS_CLAIM = 'urn:gdcom:personal_access'

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Vrai si au moins une organisation de la personne a le droit d'usage `gd-map`.
 *
 * Claim absent ou abîmé : pas d'accès. Une adhésion illisible est ignorée sans fermer la porte à
 * celles qui sont lisibles, et un droit d'usage illisible vaut absent : c'est le seul repli qui ne
 * donne jamais plus d'accès que prévu.
 */
export function hasMapEntitlement(claim: unknown): boolean {
  if (!Array.isArray(claim)) return false
  return claim.some((membership) => isObject(membership) && typeof membership.id === 'string' && isObject(membership.entitlement))
}

/** La porte d'entrée : une organisation qui a le droit d'usage, ou un accès donné à la personne. */
export const hasMapAccess = (profile: Record<string, unknown>) =>
  profile[PERSONAL_ACCESS_CLAIM] === true || hasMapEntitlement(profile[ORGANIZATIONS_CLAIM])

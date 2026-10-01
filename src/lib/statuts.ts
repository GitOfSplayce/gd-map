// Statuts des commerciaux : une seule écriture par statut, quelles que soient la casse et les accents
// (« A recruter » et « À recruter », « Agent Commercial » et « Agent commercial » ne font qu'un).
import { nameKey } from './text'

/** Statuts proposés d'office ; leur écriture l'emporte sur les variantes. */
export const STATUT_SUGGESTIONS = ['VRP', 'Agent commercial', 'ATC', 'À recruter']

const clean = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ')

/**
 * Écriture retenue pour chaque statut : celle des suggestions, sinon la plus fréquente parmi `existing`
 * (à égalité : la plus accentuée, puis l'ordre alphabétique).
 */
export function canonicalStatuts(existing: readonly (string | null | undefined)[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>()
  for (const raw of existing) {
    const s = clean(raw)
    if (!s) continue
    const k = nameKey(s)
    const variants = counts.get(k) ?? new Map<string, number>()
    variants.set(s, (variants.get(s) ?? 0) + 1)
    counts.set(k, variants)
  }
  const accents = (s: string) => s.normalize('NFD').length - s.length
  const out = new Map<string, string>()
  for (const [k, variants] of counts) {
    const best = [...variants].sort((a, b) => b[1] - a[1] || accents(b[0]) - accents(a[0]) || a[0].localeCompare(b[0], 'fr'))[0][0]
    out.set(k, best)
  }
  for (const s of STATUT_SUGGESTIONS) out.set(nameKey(s), s)
  return out
}

/** Fonction qui ramène un statut saisi ou importé à son écriture retenue (null si vide). */
export function statutNormalizer(existing: readonly (string | null | undefined)[]) {
  const canon = canonicalStatuts(existing)
  return (s: string | null | undefined): string | null => {
    const c = clean(s)
    return c ? (canon.get(nameKey(c)) ?? c) : null
  }
}

/** Liste du sélecteur de statut : suggestions et statuts existants, sans doublon, triés. */
export const statutChoices = (existing: readonly (string | null | undefined)[]) =>
  [...canonicalStatuts(existing).values()].sort((a, b) => a.localeCompare(b, 'fr'))

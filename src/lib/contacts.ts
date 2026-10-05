// Téléphone et e-mail des commerciaux et des managers : mise en forme, contrôle de saisie et liens.

const digits = (s: string) => s.replace(/\D/g, '')

/** Format accepté en base (chiffres, espaces, + . - et parenthèses). */
const PHONE_CHARS = /^[0-9+() .-]{6,25}$/
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * Numéros français remis au format « 06 12 34 56 78 » : « 0612345678 », « 06.12.34.56.78 », « +33 6 12 34 56 78 »,
 * « +33 (0)6… », « 0033… », et « 612345678 » (zéro perdu par Excel). Les autres numéros sont seulement nettoyés.
 */
export function formatPhone(raw: string | number | null | undefined): string {
  const t = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (!t) return ''
  const compact = t.replace(/[\s().-]/g, '')
  let national: string | null = null
  const fr = /^(?:\+|00)33(?:0)?(\d{9})$/.exec(compact)
  if (fr) national = '0' + fr[1]
  else if (/^0\d{9}$/.test(compact)) national = compact
  else if (/^[1-9]\d{8}$/.test(compact)) national = '0' + compact
  return national ? national.replace(/(\d{2})(?=\d)/g, '$1 ') : t
}

/** Problème d'un numéro saisi, ou null s'il convient (vide compris). */
export function phoneIssue(raw: string | null | undefined): string | null {
  const f = formatPhone(raw)
  if (!f) return null
  return PHONE_CHARS.test(f) && digits(f).length >= 6 ? null : `« ${String(raw).trim()} » n'est pas un numéro de téléphone.`
}

export const normalizeEmail = (raw: string | null | undefined) => String(raw ?? '').trim().toLowerCase()

/** Problème d'une adresse saisie, ou null si elle convient (vide compris). */
export function emailIssue(raw: string | null | undefined): string | null {
  const e = normalizeEmail(raw)
  return !e || EMAIL.test(e) ? null : `« ${String(raw).trim()} » n'est pas une adresse e-mail.`
}

/** Lien d'appel : « tel:+33612345678 » pour un numéro français, sinon les chiffres tels quels. */
export function phoneHref(phone: string): string {
  const d = digits(phone)
  if (phone.trim().startsWith('+')) return `tel:+${d}`
  return d.length === 10 && d.startsWith('0') ? `tel:+33${d.slice(1)}` : `tel:${d}`
}

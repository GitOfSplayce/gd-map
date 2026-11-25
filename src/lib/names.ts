// Écriture des noms de personnes (D-015) : « NOM Prénom », le nom de famille en majuscules, devant.

const PARTICLES = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'van', 'von', 'di', 'da', 'del', 'el', 'ben'])

const upper = (w: string) => w.toLocaleUpperCase('fr')
const hasLetter = (w: string) => /\p{L}/u.test(w)
/** Un mot écrit en majuscules ; une lettre seule (« À ») ne dit rien. */
const isCaps = (w: string) => w.length > 1 && hasLetter(w) && w === upper(w)
const isParticle = (w: string) => PARTICLES.has(w.toLocaleLowerCase('fr'))

/**
 * « Dupont Marie » et « Marie DUPONT » → « DUPONT Marie ». Le nom de famille est le mot déjà en majuscules, sinon
 * le premier ; sa particule le suit (« De Tremble Sacha » → « DE TREMBLE Sacha »). Tout en majuscules, on ne sait
 * pas où finit le nom : rien ne change.
 */
export function formatName(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) return upper(words.join(''))
  if (words.every((w) => isCaps(w) || !hasLetter(w))) return words.join(' ')

  let from = words.findIndex(isCaps)
  let to = from + 1
  if (from >= 0) {
    // Nom en plusieurs mots : « LE TILLEUL », « CHARME - ORME »
    while (to < words.length && (isCaps(words[to]) || (!hasLetter(words[to]) && to + 1 < words.length && isCaps(words[to + 1])))) to++
    while (from > 0 && isParticle(words[from - 1])) from--
  } else {
    from = 0
    to = 1
    while (to < words.length - 1 && isParticle(words[to - 1])) to++
  }
  return [...words.slice(from, to).map(upper), ...words.slice(0, from), ...words.slice(to)].join(' ')
}

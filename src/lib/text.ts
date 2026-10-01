// Normalisation de textes, sans dépendance (utilisable par la carte sans charger SheetJS).

const stripAccents = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/** "Nb de jour / an " → "nbdejouran", "Région" → "region". */
export const headerKey = (s: unknown) =>
  stripAccents(s)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/** Clé de rapprochement des noms entre le fichier et la base. */
export const nameKey = (s: unknown) =>
  stripAccents(s)
    .toLowerCase()
    .replace(/[\s–—-]+/g, ' ')
    .trim()

/** « 0 zone », « 1 commercial », « 3 commerciaux » : singulier pour 0 et 1, comme en français. */
export const plural = (n: number, singular: string, pluralForm = singular + 's') =>
  `${n} ${Math.abs(n) >= 2 ? pluralForm : singular}`

/** Accord simple d'un mot selon un nombre (sans le nombre) : agree(2, 'supprimé') → « supprimés ». */
export const agree = (n: number, singular: string, pluralForm = singular + 's') => (Math.abs(n) >= 2 ? pluralForm : singular)

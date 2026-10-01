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
